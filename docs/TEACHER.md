# Teacher 班主任工作台

## 责任范围

Teacher 面向班主任和平台导师，负责已分配学生的日常支持、问题处理、人工干预、项目复核和统计。Teacher 不负责平台知识库、模板库、数据库迁移、模型凭证或 AI runtime 治理。

实现入口：`apps/teacher-workspace`、`services/api/src/modules/reminders`、`services/api/src/modules/projects`、`services/api/src/modules/works`、`services/api/src/modules/directory`。

## 业务导航

- 工作台
- 学生管理
- 问题处理
- 数据统计

账号与安全属于跨角色账户面，不属于 Teacher 业务导航。平台治理和 AI 设置归 Admin。

## 权限边界

- 只能读取当前有效 mentor assignment 覆盖的学生。
- 一个学生同一时间只能有一个当前班主任。
- 后端每个请求重新执行对象级授权，前端隐藏入口不构成权限。
- 学生成长、掌握度、项目阶段、审计和原始对话不是 Teacher 可直接写入的对象。
- Teacher 的干预、反馈、复核和升级必须经 owner 服务、幂等键和审计记录。
- 默认显示脱敏摘要和必要证据，不显示不必要的原始对话或原始音频。

## 可执行工作流

```text
负责学生列表
  -> 查看授权学习摘要
  -> 处理卡顿 / 升级提醒
  -> 添加人工指导或复核意见
  -> 领域服务写入干预命令
  -> 审计 + 通知 / outbox
```

Teacher 不能直接：

- 推进项目阶段；
- 写入 `TheoryMastered` 或掌握度事件；
- 修改学生画像事实或 Agent 全局策略；
- 发布知识库、模板库或模型配置；
- 通过 HTTP 执行数据库迁移。

## 页面状态

学生列表、问题处理、项目复核和统计页面必须覆盖 `loading`、`empty`、`error`、`offline`、`permission-denied`。无权学生不得通过错误消息、分页计数或空状态推断其存在。

## 关联文档

- [ADMIN.md](./ADMIN.md)
- [PARENT.md](./PARENT.md)
- [PERMISSIONS.md](./PERMISSIONS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
