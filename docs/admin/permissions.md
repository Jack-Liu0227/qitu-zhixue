# 权限模型与审计

> 原则：**前端只负责显示，后端必须执行对象级权限校验**。
> 实现：`services/api/src/common/access/`、`packages/permissions`。
> 相关：[`authentication.md`](./authentication.md)（会话与登录）、[`directory-and-relationships.md`](./directory-and-relationships.md)（关系真源）、[`database.md`](./database.md)。

## 1. 角色

| 角色 | 说明 | 数据可见范围 |
|---|---|---|
| `student` | 学生 | 仅自己的学习数据 |
| `parent` | 家长 | 仅**已授权**孩子的脱敏视图 |
| `teacher` | 班主任 | 仅**当前分配给自己**的学生 |
| `admin` | 管理员 | 平台治理；原始数据访问需二次确认与审计 |
| `support` | 客服（规划） | 按工单查看必要信息（范围最窄） |

## 2. 关系与授权（对象级）

对象级权限不是角色字符串，而是**关系解析结果**：

```text
student ← guardian_links(status=active) → parent        家长—孩子
student ← mentor_assignments(status=active) → teacher   学生—班主任（同一时间唯一）
```

- 一个学生同一时间只能有一个当前班主任（数据库部分唯一索引兜底）。
- 家长只能访问 `guardian_links` 中 `status=active` 的孩子。
- 班主任只能访问 `mentor_assignments` 中 `status=active`、`mentor_user_id=自己` 的学生。
- 关系变更保留历史（`status=ended` + `endedAt`），**不做物理删除**。
- 关系绑定的唯一数据源是 `DirectoryService`（Postgres 或内存引擎），四端都从它读，不各自维护名单。

## 3. 判定顺序（每个请求）

```text
1. 会话有效？            → 401
2. 角色匹配？            → 403（已登录但角色不符）
3. 资源归属 / 关系成立？ → 403（越权，不得泄露资源是否存在）
4. 资源可见性 / 授权状态？ → 403
5. 敏感读取？            → 需原因 + 二次确认 + 审计
```

实现集中在 `services/api/src/common/access/request-auth.ts`：

- `requireAnyRole(auth, cookie)`：任意已登录角色。
- `requireRole(auth, cookie, role, message)`：指定角色；不符抛 403。
- `pickFields(body, keys)`：写接口字段白名单，防止客户端注入服务端字段。
- 会话 cookie：HttpOnly `qitu_session`；登录态不放入 `localStorage`。

> `packages/permissions` 是**纯策略 seam**（`hasRole` / `canReadOwnedResource`），**不查库**；
> 数据库支撑的授权属于 API `access` 层，必须先解析监护关系 / 班主任分配。

## 4. 接口准入矩阵（当前实现）

| 端点 | 角色 | 对象级校验 | 状态 |
|---|---|---|---|
| `GET /auth/me` | 任意已登录 | — | 已实现 |
| `GET /teacher/*` | teacher | `TeacherService.assertTeacherCanAccessStudent` | 已实现 |
| `POST /teacher/interventions/:id/actions` | teacher | 同上 | 已实现 |
| `GET /parent/children/:childId/*` | parent | `childrenOfParent` / `guardiansOfStudent` | 已实现 |
| `POST /parent/children/:childId/encouragements` | parent | 关系成立 + `Idempotency-Key` | 已实现 |
| `POST /parent/feedback` | parent | `Idempotency-Key` | 已实现 |
| `GET /students/me/*` | student | 只读「me」 | 已实现 |
| `POST /ai-tutor/*` | student | **仅角色校验**；会话对象级归属尚未校验 | 已实现（内存会话，存在越权缺口） |
| `GET/POST/PATCH /admin/guardian-links`、`/admin/mentor-assignments` | admin | — | 已实现 |
| `GET /admin/overview`、`/admin/students`、`/admin/teachers`、`/admin/students/statistics` | admin | — | 已实现（聚合 / 治理投影） |
| `GET /admin/students/:studentId` | admin | `AccessPolicy.assertCanReadStudent`（当前对 admin **fail closed**） | 显式授权模型未落地前统一 403 |
| `GET/POST/PATCH/DELETE /admin/model-providers`、`GET/POST/PATCH /admin/ai-runtime/agents` | admin | — | 已实现（见 [`model-registry.md`](./model-registry.md)） |
| `GET/POST/PATCH/DELETE /admin/users`、`/admin/project-templates` 等 | admin | — | **未实现**（目标 M8） |
| `GET /admin/ai-runtime`、`GET /admin/initialization` | admin | `requireRole(..., 'admin')` | 已实现（只读投影；不返回密钥 / 凭证 / 原始对话） |
| `POST /admin/initialization/{knowledge\|template\|tutor}/execute` | admin | `requireRole(..., 'admin')` + `Idempotency-Key` | 已实现（同事务写 `audit_logs`） |
| `POST /admin/initialization/database/execute` | admin | `requireRole(..., 'admin')` | 恒 409 `INITIALIZATION_OPERATOR_REQUIRED` |
| `GET /admin/audit-logs` | admin | `requireRole` + PostgreSQL audit filters | 已实现（分页、actor/target/time 过滤） |

## 5. 管理员与班主任边界

判定规则与当前实现状态见 [`platform-governance.md`](./platform-governance.md) §3。
摘要：管理员默认只看到聚合 / 治理投影；访问个别学生须「目的 / 原因 → 二次确认（敏感时）
→ 写审计 → 限时范围 → 最小字段」。

## 6. 一句话规则

- 前端隐藏按钮**不构成授权依据**；后端必须重新判定。
- 越权返回 **403**，且不应通过响应差异泄露资源是否存在。
- 管理控制面只读优先；受限初始化仅向 admin 开放，数据库迁移永远不经 HTTP。
- 涉及未成年人数据时默认最小化可见范围，并保留审计记录。

## 7. 审计

应当记录的事件：

- 登录 / 退出；家长绑定 / 解绑；班主任分配 / 转派；原始对话查看；
  作品导出 / 删除；AI 策略修改；模型配置修改；管理员越权授权。

当前状态：`audit_logs` 表已建（含 `idempotency_key` 唯一索引），模型注册表写操作、控制面初始化和 live 管理端敏感读已接入审计；demo 无数据库时明确不伪造持久审计。

## 8. 幂等

所有写操作需携带 `Idempotency-Key`（项目创建、阶段完成、任务 / 作品提交、导师分配、
干预发送、关系绑定）。同 key 重放返回第一次的结果，不产生第二条记录。

已实现：`DirectoryService` 的关系写操作、`ParentController` 的鼓励与反馈写操作、
控制面初始化。未实现 / 待接线：项目、任务、作品（对应写入模块尚未接线）。

## 9. 验收标准

- [ ] 班主任访问未分配学生返回 403。
- [ ] 家长访问未授权孩子返回 403。
- [ ] 给已有当前班主任的学生再分配返回 409（`MENTOR_ALREADY_ASSIGNED`），换班主任只能走 transfer。
- [ ] 学生不能修改自己的成长指标或项目状态。
- [x] 管理员敏感读写入审计；`GET /admin/audit-logs` 可查询。

- [ ] 写操作缺 `Idempotency-Key` 返回 422。
- [x] 管理员默认落地页为聚合 / 治理视图，不进入个别学生日常处理。
- [ ] 管理员个别学生访问要求目的 / 原因、审计与限时；敏感读取需二次确认。
- [x] 管理员个别学生详情已 fail closed（后端直接请求仍 403）。

## 10. 未决事项

- [x] 审计写入与查询接口已实现（敏感读查询在 live 模式要求数据库可用）。
- [ ] `support` 角色的具体授权范围未定。
- [ ] MFA、会话轮换与撤销（当前会话在进程内，过期即失效）尚未实现。
- [ ] AI 搭档会话的**对象级归属校验**（当前只校验 `student` 角色）。
- [ ] 原始对话 / 语音的敏感访问审批流程。
- [ ] 数据保留与删除策略落表。
- [ ] 管理员个别学生访问的范围 / 原因 / 二次确认 / 限时授权模型。
- [ ] 跨角色账户面（凭证、MFA、设备会话、退出）。
