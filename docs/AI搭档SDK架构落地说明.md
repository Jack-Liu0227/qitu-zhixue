# AI 搭档基础设施落地说明

## 运行链路

学生端的 AI 搭档通过 `@qitu/ai-client` 组装服务端上下文。Nest 模块只依赖 SDK 的端口，不把数据库对象暴露给模型调用层：

```
student-center
  -> /api/v1/tutor/stream
  -> TutorService
  -> TutorSdk.buildContext()
  -> PostgreSQL adapter
     -> learner profile / memories
     -> template documents
     -> knowledge documents
  -> ModelGateway.complete('tutor.chat')
```

SDK 端口覆盖：伙伴初始化、模板和知识文档 upsert、记忆写入、成长事件幂等写入、画像投影更新和受权限过滤的检索。成长事件只保存摘要和不透明证据引用，不保存未成年人原始对话。

Agent 专属记忆现在由 `agent_memory_records` 作为权威表：学生与 Partner 的关系记忆和管理员评审后的 Partner 策略记忆分开；关系记忆默认 90 天有效，纠错/删除先在本地失效，再通过 `agent-memory.index` Outbox 任务清理外部索引。Mem0 仅作为可替换的索引端口，本轮不自动抽取完整对话，也不允许模型直接写成长档案。

## 数据初始化

执行迁移后运行：

```bash
DATABASE_URL=postgresql://... pnpm --filter @qitu/database seed
```

种子会同时初始化 `qitu-learning-partner`、系统模板和核心教学知识文档。学生端灵感空间默认读取 `/api/v1/tutor/templates`，不会在真实模式静默退回 fixture。

## Qwen 3.8 Flash

模型注册表预置了 `qwen3.8-flash`，兼容 OpenAI Chat Completions 协议。管理员仍需在模型注册表中配置供应商凭证并将用途 `tutor.chat` 绑定到该模型；凭证只能通过 `QITU_MODEL_SECRET_KEY` 加密存储，代码和种子不包含密钥。

建议 live 环境：

```bash
QITU_DATA_MODE=live
DATABASE_URL=postgresql://...
QITU_MODEL_SECRET_KEY=...
```

## 检索边界

当前知识空间使用 PostgreSQL 持久文档和受学生/项目作用域过滤的关键词相关度检索，检索结果以有限长度证据注入 `context_packet`。这已经是真实的检索增强链路，但尚未引入 pgvector/embedding 依赖；后续可以在不改 SDK 合同的情况下，将 `searchKnowledge` adapter 替换成向量或混合检索实现。

## 产品不变量

- 兴趣探索未确认前不创建正式项目。
- `TheoryMastered` 由服务端掌握度逻辑产生，实践不能由客户端解锁。
- AI 不能直接写成长档案；它只能追加带幂等键的成长信号，由 SDK 生成最小画像投影。
- 提示等级、阶段、序号、审计和权限全部由服务端决定。
- 学生端覆盖 loading、empty、error、offline、permission-denied 状态。
