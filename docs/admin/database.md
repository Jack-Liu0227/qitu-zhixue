# 数据库与表归属

> PostgreSQL 是业务 system of record。Graphiti、Redis 和其他外部投影都是可重建的异步能力，不承担权限、项目状态或掌握度的最终判定。
>
> 代码入口：`packages/database/`；迁移产物：`database/migrations/`；种子：`database/seeds/`。

## 1. 代码与产物

| 位置                   | 责任                                         |
| ---------------------- | -------------------------------------------- |
| `packages/database/`   | Drizzle schema、连接、事务和 seed 入口       |
| `database/migrations/` | forward-only SQL 迁移及对应 `.down.sql` 说明 |
| `database/seeds/`      | 幂等演示身份、Tutor、领域基础和平台配置      |
| `database/fixtures/`   | 测试数据，不作为生产初始化来源               |

`packages/database` 导出运行时值，`services/api` 启动前必须先构建其 `dist/`；`tooling/start-qitu-services.sh` 已包含这一准备步骤。

## 2. Schema 约定

- 固定业务标识使用 `text`，状态使用 `text` + 应用层枚举。
- 时间使用带时区的 `timestamp`，默认值由数据库生成。
- 结构化上下文、配置和候选结果使用 JSONB，但不能用 JSONB 绕过领域校验。
- 用户邮箱使用不区分大小写的唯一索引。
- 所有写操作都要考虑幂等键、唯一约束和可审计性；迁移保持 forward-only。

核心数据库约束包括：

```sql
-- 一个学生同一时间只能有一个当前班主任
mentor_assignments(student_user_id) WHERE status = 'active'

-- 同一学生与家长只有一个 active 监护关系
guardian_links(parent_user_id, student_user_id) WHERE status = 'active'

-- 同一 provider 下 model_id 不重复
model_models PRIMARY KEY (provider_id, model_id)

-- 写操作幂等键不可重复
audit_logs(idempotency_key)
idempotency_keys(scope, key)

-- 同一学生与目标只有一条当前掌握度记录
mastery_records(student_user_id, objective_id)

-- Team Run 的 active mentor 约束
agent_team_runs(student_user_id) WHERE status = 'active'
```

## 3. 单一写入者

| 领域                | 主要表和职责                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Identity & Access   | `users`、`households`、`guardian_links`、`mentor_assignments`、`sessions`                                |
| Projects & Learning | `project_templates`、`projects`、`learning_plans`、`learning_sessions`、`mastery_*`                      |
| AI Tutor            | `tutor_sessions`、`tutor_turns`、`tutor_partners`、`context_snapshots`、记忆候选                         |
| Works               | `artifacts`、`artifact_versions`、`project_evidence`、`review_records`                                   |
| Growth              | `growth_records`、`growth_snapshots`、`milestones`、`student_memories`                                   |
| Mentor Ops          | `mentor_reviews`、`alerts`、`interventions`、`feedback_tickets`、知识库表                                |
| Parent Experience   | `parent_growth_exports`、`notifications`，只读授权投影                                                   |
| Admin & Compliance  | `audit_logs`、`outbox`、初始化记录、模板验证、AI 运行记录                                                |
| Model Registry      | `model_providers`、`model_models`、旧 `model_usage_bindings` 兼容表                                      |
| Admin AI / Team     | `agent_configs`、`agent_routes`、`agent_mailboxes`、`agent_team_runs`、tasks、messages、events、候选投影 |
| Public Site         | `consultation_requests`，唯一公开写入口                                                                  |

跨域写入通过命令、领域事件或 outbox；页面不能直接更新其他模块的表。家长只读取经过授权和脱敏的投影，AI 或 Team Runtime 结果必须先进入候选状态。

## 4. 迁移顺序

当前迁移目录为 `0000` 到 `0021`，顺序以 `database/migrations/meta/_journal.json` 为准：

```text
0000-0006  基础身份、项目、学习、运营与模型表
0007       Tutor 工作区适配层
0008-0009  领域基础与模板验证证据
0010       Agent Memory
0011-0012  Mastery 时间线与 Graphiti receipt
0013       Tutor exploration/project context
0014-0016  Tutor partner、Agent Runtime 绑定与直接模型选择
0017       Team Runtime：run/task/message/event、mailbox、route、outbox lease
0018       公开咨询线索与幂等约束
0019       Admin assistants、teams、members 配置
0020       启用 Team Agent route
0021       一个学生同一时间只能有一个 active mentor Team Run
```

迁移编号和历史文件不可重写；`0021_agent_team_run_mentor_uniqueness.sql` 是当前唯一性约束的事实来源，不能按旧注释误写成 `0020`。

## 5. 迁移与种子

```bash
# schema 变更后生成迁移
pnpm --filter @qitu/database generate

# 对空库按序执行 forward-only 迁移
for f in database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  case "$f" in *.down.sql) continue ;; esac
  psql "$DATABASE_URL" -f "$f"
done

# 仅本地 demo/test 使用；生产只执行迁移，不执行演示身份种子
pnpm --filter @qitu/database seed
```

服务模式由 `QITU_DATA_MODE=live|demo|test` 控制：`live` 缺少 `DATABASE_URL` 时 fail-fast；`demo`/`test` 只允许非生产环境使用。演示账号的口令不写入文档或提交记录，由受限种子和环境变量管理。

## 6. 真源、投影与回滚

- `mastery_events` 是可追溯输入，`mastery_records` 是当前掌握度投影；Graphiti receipt 只记录投影状态。
- Agent profile、growth trajectory 等结果先写入 `agent_projection_candidates`，由对应 owner 校验、幂等接受并审计后才成为正式记录。
- 数据库不可达、投影过期或外部服务不可用时，API 返回明确的 unavailable/stale 状态，前端不得伪造空数据或成功状态。
- 迁移只向前执行；回滚通过受控环境中的 `.down.sql` 或数据库备份完成，不在 HTTP 初始化接口里执行 schema migration。

## 7. 未决事项

- [ ] 将 API 当前进程内 session store 接入持久化 `sessions` 轮换和跨实例撤销。
- [ ] 完成学校隔离的 RLS / `SET LOCAL` 验证，并保留对象级权限的应用层校验。
- [ ] 为 `knowledge_chunks.embedding` 选择并验证 pgvector 索引策略。
- [ ] 完成 Tutor 旧适配层与领域真源的双写迁移计划，再删除兼容表。
- [ ] 完善数据保留、删除和未成年人敏感访问审批流程。
