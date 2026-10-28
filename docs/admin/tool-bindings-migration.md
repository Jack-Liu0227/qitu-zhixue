# 工具与 MCP 历史绑定迁移

本次处理工具页的 9 个历史 ID 提示。它们来自旧助手默认值和种子声明，并非 MCP 发现失败。源码没有这些 ID 的统一调用执行器；学习、实验、作品和汇报中的相关功能由原业务 owner 提供。通用 `data_analyzer` 仍未接入，不伪装成已可调用。

## 范围与权限

迁移规则见 `LEGACY_TOOL_BINDING_RESOLUTIONS`。只从当前可编辑的助手 `toolIds` 中移除明确识别、且当前目录没有登记的旧声明。不增加替代工具或权限，不修改模型、Skills、MCP、提示词、冻结团队版本、历史项目、掌握度和成长记录。若未来同名 ID 真正成为 canonical 工具，不再按旧声明迁移。完全未知的 ID 保留并继续提示。

当前内置助手与三个 seed 文件只声明 canonical 工具，避免新安装或显式重播 seed 再次产生这些占位绑定。生产修复不重播 seed，不运行手工 SQL 清理。

## Admin 专用 API

- `GET /api/v1/admin/ai-runtime/tools/bindings-migration` 返回 revision、每个助手的原/新工具集合、处理说明与未识别 ID。
- `PATCH` 同路径，仅接受 `{revision}` 和 `Idempotency-Key`。Admin 角色在控制器和服务再次校验；客户端不能提交任意迁移结果。
- 服务端在同一事务按稳定顺序锁定助手、重新计算预览、更新、校验 RETURNING 回执并写审计。并发修改返回 409，不覆盖新绑定。同键重试返回同一回执。
- `TOOL_BINDINGS_CHANGED`/409 表示助手或目录已变化；`TOOL_BINDING_READBACK_FAILED`/409 表示写入回执不符，事务回滚；缺幂等键为 `IDEMPOTENCY_KEY_REQUIRED`/400；非 Admin 为 403，匿名为 401，存储不可用为 503。
- `admin.assistant.tools.migrate` 审计保留原/新工具 ID、处理说明和策略版本，无提示词、凭据或学生内容。审计失败会回滚全部绑定更新。

前端先展示具体预览，再提交服务端 revision；提交完成后重新读取运行时和助手，确认已识别的旧绑定确实消失才显示成功。失败、断网、目录不可用和回读失败均明确提示，不乐观修改矩阵。

## MCP 状态

目录登记、驱动配置、连接探测、助手授权、实际调用分别判断。IMA 保留已有专用适配器和四个只读工具，实际项目授权继续取冻结 grant 与当前全局/助手/对象权限交集。历史 fetch/Grok/browser manifest 没有驱动时仍为 disabled/not_configured，不因本次修复标成可用或被授权。

## 验证

纯规则测试覆盖最小权限、未知 ID 保留、未来 canonical 同名实现、revision 与 seed/default 一致性。隔离 PostgreSQL 测试只允许 `qitu_tool_migration_fixture_*` 本地数据库，验证角色隔离、并发冲突、事务与审计回滚、真实回读不符和幂等重放。fixture 只复制 schema，不复制业务数据，不连接生产库运行这些测试。

发布后通过 Admin owner API 读取真实预览并应用，对比工具之外的全部助手字段和冻结版本未变化，回读运行时目录，再做浏览器和 MCP 状态验收。不能以迁移成功代替任意 MCP 工具真实调用成功。

历史回执见 [计划与执行记录](../../Plan/maintenance/usage-records-20261028.md)。