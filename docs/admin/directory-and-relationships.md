# 用户、家庭与关系绑定

> 责任域：Identity & Access。唯一数据源：`DirectoryService`
> （`services/api/src/modules/directory/directory.service.ts`）。
> 管理端接口：`services/api/src/modules/admin/directory-admin.controller.ts`，
> 页面：`/admin/relationships`、`/admin/students`、`/admin/teachers`。

## 1. 关系是对象级授权的根据

对象级权限不是角色字符串，而是**关系解析结果**：

```text
student ← guardian_links(status=active) → parent        家长—孩子
student ← mentor_assignments(status=active) → teacher   学生—班主任（同一时间唯一）
```

四端（学生 / 家长 / 班主任 / 管理员）都从 `DirectoryService` 读关系，**不各自维护名单**。
关系变更保留历史（`status=ended` + `endedAt`），**不做物理删除**。

## 2. 数据结构

| 表 | 说明 | 约束 |
|---|---|---|
| `users` | 账号（邮箱大小写不敏感唯一） | `uniqueIndex users_email_lower_idx (lower(email))` |
| `households` | 家庭 | — |
| `guardian_links` | 家长—孩子监护关系 | 同父 / 学生只允许一条 `active`：`guardian_links_active_unique_idx (parent_user_id, student_user_id) WHERE status='active'` |
| `mentor_assignments` | 学生—班主任分配 | **一个学生同一时间只能有一个当前班主任**：`mentor_assignments_one_active_per_student_idx (student_user_id) WHERE status='active'` |
| `schools` | 校域根表 | `school_id IS NULL` = 平台共享，非空 = 该校私有 |

## 3. 管理端关系接口

```http
GET   /api/v1/admin/guardian-links                 监护关系列表
POST  /api/v1/admin/guardian-links                 新建 / 绑定
PATCH /api/v1/admin/guardian-links/:linkId         更新
POST  /api/v1/admin/guardian-links/:linkId/end     解除（status=ended）

GET   /api/v1/admin/mentor-assignments             班主任分配列表
POST  /api/v1/admin/mentor-assignments             分配
POST  /api/v1/admin/mentor-assignments/:id/end     结束
POST  /api/v1/admin/mentor-assignments/transfer    换班主任（转派）
```

规则：

- 给**已有**当前班主任的学生再分配 → `409 MENTOR_ALREADY_ASSIGNED`；换班主任**只能走 transfer**。
- 所有关系写操作需携带 `Idempotency-Key`，同 key 重放返回首次结果。
- 关系写操作在同一事务内写 `audit_logs`。

## 4. 目录与统计

```http
GET /api/v1/admin/overview              平台总览（聚合）
GET /api/v1/admin/students              学生列表（聚合 / 治理投影）
GET /api/v1/admin/students/:studentId   学生详情（**当前 fail closed → 403**）
GET /api/v1/admin/teachers              班主任列表
GET /api/v1/admin/teachers/:teacherId   班主任详情
GET /api/v1/admin/students/statistics   学生数据统计（聚合）
```

- 列表与统计是**聚合 / 治理投影**，不进入个别学生日常处理。
- `/admin/students/:studentId` 在显式授权模型落地前对 admin 统一 403（见
  [`platform-governance.md`](./platform-governance.md) §3）。

## 5. 家庭 / 监护与学校

- 家长只能访问 `guardian_links` 中 `status=active` 的孩子。
- 班主任只能访问 `mentor_assignments` 中 `status=active`、`mentor_user_id=自己` 的学生。
- 校域：`school_id` 可空列约定 `NULL` = 平台共享。行级安全（RLS）与多校租户切换**尚未实现**，
  当前 `school_id` 仅供应用层过滤，权限仍由后端逐对象校验。

## 6. 未决事项

- [ ] `roles` / `identities` / `sessions` / `consents` / `student_profiles` / `mentor_profiles` 正式结构与迁移。
- [ ] `student_profiles.school_id` 落表。
- [ ] 行级安全（RLS）/ `SET LOCAL` 会话变量与跨校写入强制校验。
- [ ] 数据保留与删除 / 匿名化策略。

## 7. 相关文档

- [`permissions.md`](./permissions.md)
- [`authentication.md`](./authentication.md)
- [`database.md`](./database.md)
