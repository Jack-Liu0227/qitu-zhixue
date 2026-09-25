# ADR 0002：领域边界和单一写入者

## 领域模块

### Identity & Access

负责用户、角色、会话、家庭、监护关系、班主任分配和对象级访问策略。

### Projects & Learning

负责项目模板版本、项目实例、阶段、任务、理论检查、提交和状态机。所有项目状态转换必须经过这里。

### AI Tutor

负责导师会话、turn、context packet、提示等级、模型路由和卡顿检测。不得直接更新项目状态或成长档案。

### Mentor Operations

负责告警、问题、干预、班主任笔记和知识库。干预通过项目/AI 的公开命令接口生效。

### Parent Experience

负责家长成长快照、消息和反馈。只能读取经过授权和脱敏的投影。

### Admin & Compliance

负责平台配置、AI 策略版本、审计、数据保留和敏感访问审批。

## 依赖规则

```text
apps → packages/contracts + packages/api-client + packages/ui
apps ✕ apps/* 业务代码
api modules → domain/application/infrastructure/presentation
api modules ✕ 直接写其他模块的数据库表
cross-domain writes → command/event/outbox
parent reads → authorized projection only
```

## 关键约束

- `projects` 是项目状态机的唯一写入者。
- `access` 是家长和班主任对象级授权的唯一政策入口。
- `audit` 记录敏感读取和管理变更。
- `idempotency` 保护项目创建、任务提交、作品提交和干预发送。
- `outbox` 保证数据库事务和异步事件投递的一致性。
