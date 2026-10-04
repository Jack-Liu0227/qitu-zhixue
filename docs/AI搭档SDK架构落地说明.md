# AI 搭档 SDK 实现补充

> 本文是实现记录，不是独立规范。SDK 合同、边界和验证要求以 [`SDK.md`](./SDK.md) 为准；平台运行时治理以 [`ADMIN.md`](./ADMIN.md) 为准。

## 当前链路

```text
student-center
  -> /api/v1/tutor/sessions/:id/stream
  -> TutorService
  -> TutorContextReader.buildContext()
  -> authorized projection ports
  -> ModelGateway.complete('tutor.chat')
  -> TutorDomainWriter / owner command
```

## 当前边界

- `TutorContextReader` 只负责有界上下文读取。
- `TutorDomainWriter` 只提交服务端定义的成长和领域命令。
- 知识库、模板库、Agent Partner 和运行时 Skill 由 Admin 控制面治理，Tutor SDK 不提供资源库管理写入方法。
- Agent Runtime 通过 `createTutorAgentRuntime()` 绑定 API 授权的 scope，调用方不能替换学生或项目范围。
- Agent 不能持有数据库句柄，模型输出不能直接写项目阶段、掌握度、成长档案、画像、记忆或审计。
- 成长更新统一走 `TutorWorkspaceService.commitGrowthSignal()` 的原子事务，并使用幂等键。
- 记忆索引是可重建投影；`agent_memory_records` 和 PostgreSQL 领域表由服务端 owner 管理。

## 探索与项目会话

推荐项目保留灵感空间的详情和确认流程；自由探索与项目辅导进入同一个 Tutor 页面：

- 自由探索：`source: exploration`，关联已授权 exploration 草稿；
- 项目辅导：`source: project`，关联已授权 `projectId`；
- 正式项目必须在学生确认意图后由 Projects owner 幂等创建。

## 相关代码

- `packages/contracts/src/agent-runtime.ts`
- `packages/ai-client/src/agent-runtime.ts`
- `packages/ai-client/src/tutor-context.ts`
- `packages/ai-client/src/agent-context-adapter.ts`
- `services/api/src/modules/ai-tutor/tutor.service.ts`
- `services/api/src/modules/ai-tutor/tutor-workspace.service.ts`
- `services/api/src/modules/platform-registry/built-in-tools.ts`
