# 计划、研究与实施记录

更新日期：2026-10-28。所有计划文档统一存放于仓库根目录 `Plan/`；项目使用说明位于 [docs/README.md](../docs/README.md)，协作规则见 [AGENTS.md](../AGENTS.md)。

| 目录 | 内容与入口 |
| --- | --- |
| `codex/` | [专题研究、架构、实施计划与验证](./codex/README.md) |
| `design/` | [架构、交互与视觉设计](./design/README.md) |
| `student/` | [学生端教学与开场方案](./student/README.md) |
| `pedagogy/` | [教学法、课程内容与模板实施材料](./pedagogy/README.md) |
| `research/` | [专项技术调研](./research/README.md) |
| `issues/` | [问题、实施与验收记录](./issues/README.md)，证据保留在各记录关联目录 |
| `releases/` | [发布记录及结构化回执](./releases/README.md) |
| `diagnostics/` | [诊断、配置修复与集成验证](./diagnostics/README.md) |
| `maintenance/` | [从使用说明分离的待办、实施步骤和历史回执](./maintenance/usage-records-20261028.md) |
| `UI/` | [界面评审、优化方案与浏览器证据](./UI/README.md) |
| `archive/` | [历史资料与不可改写的快照](./archive/README.md) |

## 维护约定

- 需求、研究、方案、任务拆解、Issue、进度、发布、测试验收和历史归档都写入本目录；功能落地后另行更新 `docs/` 的实际操作说明。
- 每份计划标明日期、状态和验收边界。原日期的技术状态、测试数量和发布结果不能当作当前结论。
- 新增或移动文档时更新索引、Markdown 链接、源码注释、脚本和结构化清单；附件随文档迁移。历史快照保留原文与摘要。
- 运行 `python -B tooling/validate-docs.py` 检查目录与链接；历史快照和证据清单另用 `node tooling/check-codex-plan.mjs` 检查。

## 近期整理与早期方案

- [2026-10-28 文档目录分离与验证](./issues/20261028-document-layout.md)
- [2026-10-26 仓库整理记录](./issues/20261026-repository-cleanup.md)
- [2026-10-18 飞书汇报与问题摘要方案](./20261018-issue-digest-feishu-assistant.md)
- [2026-10-18 技能、工具治理与任务分配](./20261018-skill-tool-governance-and-assignment.md)
