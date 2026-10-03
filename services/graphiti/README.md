# Mastery Graphiti Bridge

这是启途掌握度事件的**私有结构化投影 bridge**，不是聊天记忆 API，也不接受原始对话、语音或客户端写入。

## 本地启动

前置：Docker、Docker Compose、PostgreSQL 已存在并完成启途迁移 `0000..0012`。

```bash
export GRAPHITI_NEO4J_PASSWORD='use-a-local-secret'
export QITU_GRAPHITI_TOKEN='use-a-local-token'
export GRAPHITI_NEO4J_URI='bolt://neo4j:7687'
export GRAPHITI_NEO4J_USER='neo4j'
docker compose -f services/graphiti/docker-compose.yml up -d neo4j bridge
```

初始化约束：

```bash
docker compose -f services/graphiti/docker-compose.yml run --rm bridge python bridge.py --init-schema
```

启用 Worker 时：

```bash
export QITU_GRAPHITI_ENABLED=true
export QITU_GRAPHITI_URL='http://127.0.0.1:4180'
export QITU_GRAPHITI_TOKEN='use-a-local-token'
pnpm --filter @qitu/workers mastery:once
```

生产环境不要把 Neo4j 密码或 bridge token 写入 Git、compose 文件或日志。`QITU_GRAPHITI_ENABLED`
默认必须保持 `false`；未启用时掌握度、项目门槛和成长读取继续使用 PostgreSQL。

## Bridge 边界

- 只接受 `mastery-event:{eventId}` 结构化事件。
- 只写确定性 `Student -> KnowledgePoint` 评估边。
- 通过 event id 和 payload hash 幂等。
- Graphiti/Neo4j 不决定授权、`TheoryMastered` 或项目状态。
- telemetry、LLM 抽取和 embedding 不由 bridge 自动启用。
- 删除/纠错以 PostgreSQL 事件账本和 receipt 对账为准。

真实 Neo4j round-trip、恢复演练、P95 延迟和成本是 M4 验收项，不能用本地单元测试替代。
