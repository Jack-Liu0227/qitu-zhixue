> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../../README.md) 和各责任域文档。

# 04 · 验收与测试

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

## 依赖顺序

1. `pnpm --filter @qitu/contracts build`
2. `pnpm --filter @qitu/database build`
3. `pnpm --filter @qitu/ai-client build`
4. API focused tests：templates binding、teaching bundle、projects confirm、learning-plan、tutor quiz、optics action、team graph。
5. Student UI tests：exploration confirm、lesson/stage projection、team/tool timeline、experiment fullscreen 和 offline。

## 必须覆盖的失败路径

- bundle 草稿引用展示名称而非 canonical ID。
- skill/MCP/KB/model/team 任一目录读取失败。
- binding validate/activate 的重复请求、回读失败和部分失败。
- 缺 frozen snapshot、digest 不匹配、非当前课时或越过 `TheoryMastered` 的 action。
- 学生刷新/断网后重复 confirm、quiz answer、run、record observation。

## 生产验收

记录 templateVersionId、bindingId、teamVersionId、bundleDigest、实验 specVersion、actionId 和 owner receipt；不记录未脱敏对话、语音或 provider secret。
