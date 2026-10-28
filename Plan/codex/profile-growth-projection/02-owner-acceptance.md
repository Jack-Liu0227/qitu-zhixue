> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# 02 · Domain-owner Acceptance

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

## 状态流

```text
proposed -> validating -> accepted
                    └──> rejected
accepted -> superseded (新版本接受后)
```

Worker 只负责把 Team Runtime 的结构化结果写入候选表；它不能自行把候选标记为事实。由 Growth/learning-profile owner 执行：

1. 按 `studentUserId + projectionType` 锁定最新 accepted 版本。
2. 验证 source event、证据引用归属、project 权限、输出 schema、版本递增和字段上限。
3. 在同一事务写入 accepted candidate、旧版本 superseded、审计和必要的 outbox；幂等键重复时返回既有结果。
4. 任何验证失败只写稳定错误码和最小审计元数据，不把模型原文回传前端。

## 建议接口

```text
POST /api/v1/admin/projections/:candidateId/accept
POST /api/v1/admin/projections/:candidateId/reject
GET  /api/v1/admin/projections?studentId=&type=&status=
```

这些接口只面向 Admin/教师 owner，学生端没有写路径。自动接受也必须调用同一个 owner service，而不是在 Worker SQL 中直接更新状态。

## 运行时读取

`GrowthService.getStudentProfile` 只取最新 `accepted` 行；没有 accepted 行时返回 `freshness: unavailable`。不得把 `proposed`、Tutor memory 或当前请求中的模型草稿当成页面事实。
