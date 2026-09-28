# 权限模型

> 原则：**前端只负责显示，后端必须执行对象级权限校验**（AGENTS.md、产品文档 1.4 / 3.4）。
> 本文定义角色、关系、判定顺序与各接口的准入规则，并标注当前已实现与待实现。
> 关联：ADR 0002（`access` 是对象级授权唯一政策入口）、ADR 0008（管理员与班主任边界）、`packages/permissions`、`docs/DATABASE.md`。

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
student ← guardian_links(status=active) → parent     家长—孩子
student ← mentor_assignments(status=active) → teacher  学生—班主任（同一时间唯一）
```

- 一个学生同一时间只能有一个当前班主任（数据库部分唯一索引兜底，见 `docs/DATABASE.md`）。
- 家长只能访问 `guardian_links` 中 `status=active` 的孩子。
- 班主任只能访问 `mentor_assignments` 中 `status=active`、`mentor_user_id=自己` 的学生。
- 关系变更保留历史（`status=ended` + `endedAt`），不做物理删除。
- 关系绑定的**唯一数据源**是 `DirectoryService`（Postgres 或内存引擎），四端都从它读，不各自维护名单。

## 3. 判定顺序（每个请求）

```text
1. 会话有效？            → 401
2. 角色匹配？            → 403（已登录但角色不符）
3. 资源归属/关系成立？   → 403（越权，不得泄露资源是否存在）
4. 资源可见性/授权状态？ → 403
5. 敏感读取？            → 需原因 + 二次确认 + 审计
```

判定实现集中在 `services/api/src/common/access/request-auth.ts`：

- `requireAnyRole(auth, cookie)`：任意已登录角色。
- `requireRole(auth, cookie, role, message)`：指定角色；不符抛 403。
- `pickFields(body, keys)`：写接口字段白名单，防止客户端注入服务端字段。
- 会话 cookie：HttpOnly `qitu_session`；登录态不放入 `localStorage`。

> `packages/permissions` 是**纯策略 seam**（`hasRole` / `canReadOwnedResource`），不查库；
> 数据库支撑的授权属于 API `access` 层，必须先解析监护关系/班主任分配。

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
| `GET/POST/PATCH/DELETE /admin/model-providers`、`/admin/model-usages` | admin | — | 已实现（内存） |
| `GET/POST/PATCH/DELETE /admin/users`、`/admin/project-templates` 等 | admin | — | **未实现**（目标 M8） |
| 审计日志查询 `GET /admin/audit-logs` | admin | — | **未实现** |

## 5. 管理员与班主任边界（ADR 0008）

平台治理与班级日常是两类工作，不能因为两者都能读到学生数据就混为一谈。
边界见 `docs/decisions/0008-admin-teacher-boundary.md`。

| 维度 | 班主任 `teacher` | 管理员 `admin` |
|---|---|---|
| 默认视图 | 自己名下学生的日常视图 | 聚合 / 治理视图 |
| 个别学生日常处理 | **是**（学生管理、问题处理、干预、项目复核、笔记） | **否**，不得默认进入 |
| 对象级范围 | `mentor_assignments(status=active, mentor_user_id=自己)` | 平台治理范围；个别学生需显式授权范围 |
| 全局配置权 | 无（不得改全局 AI 策略） | 模板、AI 策略、模型路由、审计、数据保留 |
| 账号与安全 | 跨角色账户面（顶栏账户入口） | 同左 |

规则：

1. 管理员默认只看到**聚合 / 治理投影**（统计、覆盖率、分布、审计）。
   进入个别学生数据必须是显式动作，不能是默认落地页。
2. 管理员访问个别学生数据（含 `/admin/students/:id`）必须同时满足：
   - **对象级授权范围**：本次访问限定到具体学生 / 资源；
   - **最小字段可见性**：只返回该目的所需字段，默认不返回原始对话与原始语音；
   - **目的 / 原因**：访问理由必填并落审计；
   - **敏感场景二次确认**：原始对话、原始语音、导出等敏感读取需二次确认；
   - **审计**：每次个别访问写 `audit_logs`；
   - **限时**：授权范围带有效时间，过期即失效。
3. 班主任的个别学生权限来自关系（`mentor_assignments`），不是角色字符串；
   班主任不得修改全局 AI 策略、不得分配其他导师、不得删除原始学习数据（产品文档 6.8）。
4. **前端隐藏入口不构成授权**：无论管理端是否渲染「进入某个学生」的按钮，
   后端都必须按本节规则重新判定；隐藏只是体验，不是安全边界。

> 实现前提（见 ADR 0008）：本节描述的是目标判定规则。对象级授权范围、目的 / 原因、
> 二次确认、限时与审计的落表与接口**尚未实现**；当前 `/admin/students/:id` 仅做
> `requireRole(admin)` 的粗粒度校验。在实现前，不得把管理员个别学生页当作已合规。

## 6. 一句话规则

- 前端隐藏按钮**不构成授权依据**；后端必须重新判定。
- 越权返回 **403**，且不应通过响应差异泄露资源是否存在。
- 管理员默认只看到聚合 / 治理数据（第 5 节）；查看任何个别学生数据需
  「目的 / 原因 → 二次确认（敏感时）→ 写审计 → 限时范围 → 最小字段」。
- 涉及未成年人数据时默认最小化可见范围，并保留审计记录。

## 7. 审计

应当记录的事件（产品文档 7.6）：

- 登录/退出；家长绑定/解绑；班主任分配/转派；原始对话查看；
  作品导出/删除；AI 策略修改；模型配置修改；管理员越权授权。

当前状态：`audit_logs` 表已建（含 `idempotency_key` 唯一索引），
但**业务写入尚未接入**（`platform-data.service.ts` 里只有一份内存占位）。
模型配置等写操作的审计随 ADR 0007 落库时补齐。

## 8. 幂等

所有写操作需携带 `Idempotency-Key`（项目创建、阶段完成、任务/作品提交、导师分配、干预发送、关系绑定）。
同 key 重放返回第一次的结果，不产生第二条记录。

已实现：`DirectoryService` 的关系写操作、`ParentController` 的鼓励与反馈写操作。
未实现：项目/任务/作品（对应模块尚未创建）。

## 9. 验收标准

- [ ] 班主任访问未分配学生返回 403。
- [ ] 家长访问未授权孩子返回 403。
- [ ] 给已有当前班主任的学生再分配返回 409（`MENTOR_ALREADY_ASSIGNED`），换班主任只能走 transfer。
- [ ] 学生不能修改自己的成长指标或项目状态。
- [ ] 管理员配置修改可追溯（审计）。
- [ ] 写操作缺 `Idempotency-Key` 返回 422。
- [ ] 管理员默认落地页为聚合 / 治理视图，不进入个别学生日常处理。
- [ ] 管理员个别学生访问要求目的 / 原因、审计与限时；敏感读取需二次确认。
- [ ] 前端隐藏入口时，直接请求后端仍返回 403。

## 10. 未决事项

- [ ] 审计写入与查询接口尚未实现。
- [ ] `support` 角色的具体授权范围未定。
- [ ] MFA、会话轮换与撤销（当前会话在进程内，过期即失效）尚未实现。
- [ ] AI 搭档会话的对象级归属校验（当前只校验 `student` 角色，未校验会话属于本人）。
- [ ] 原始对话/语音的敏感访问审批流程尚未实现。
- [ ] 数据保留与删除策略尚未落表。
- [ ] 管理员个别学生访问的范围 / 原因 / 二次确认 / 限时授权模型尚未实现（第 5 节、ADR 0008）。
- [ ] 跨角色账户面（凭证、MFA、设备会话、退出）尚未实现。
