> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# 04 · 验收与测试

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

## 必测项

- `proposed` 候选不会出现在学生画像。
- 无证据、跨学生 evidence ref、未知字段、超长数组、版本回退和重复幂等键都会被 owner 拒绝。
- accepted 新版本会原子 supersede 旧版本；重试不会产生第二条事实或第二条审计。
- Tutor turn、artifact、reflection、mastery 事件分别触发正确的 projection target，且不把原文写入候选 payload。
- 学生/家长权限、离线、空态、过期和 request identity 全部有测试。

## 验证顺序

```text
contracts -> database -> workers projection -> growth owner -> API -> student/parent UI
```

生产验收记录 candidateId、sourceEventId、projectionType、version 和 evidence ref 数量；不记录未脱敏未成年人内容。
