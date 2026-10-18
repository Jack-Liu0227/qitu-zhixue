# 2026-10-18 前历史文档归档库

> 归档时间：`2026-10-19`
> 归档说明：本目录收纳 2026-10-18 之前的历史规划提案、早期里程碑任务（P0/P1/P2）、诊断报告与设计草案，仅用于技术演进溯源与审计复核。当前活跃开发基线统一以根目录 `docs/README.md` 与对应责任域当前生效文档为准。

当前入口：[`../../README.md`](../../README.md)；实施方案：[`../../plan/codex/README.md`](../../plan/codex/README.md)。

归档正文保留当时的状态、路径和测试记录，不构成当前发布或验收证明。旧 `docs/screenshots/` 下 52 张页面截图已移除；历史诊断报告中的截图链接仅为当时的资源清单，不再可访问，不应据此验收当前 UI。当前文档及本索引的本地目标可运行 `python tooling/validate-docs.py` 校验；不把历史正文中的过时链接伪装为已恢复。

## 归档目录索引

### 1. 计划与提案 (`plan/`)
- [`antigravity/`](./plan/antigravity/)：早期 Antigravity 架构探索与对比提案（已由 `docs/plan/codex/` 规范替代）。
- [`combined/`](./plan/combined/)：早期混合方案探索（已归档，禁止引入平行的状态机或数据源）。
- 基础任务：
  - [`p0-domain-contracts.md`](./plan/p0-domain-contracts.md)：早期领域合同与时间模型。
  - [`p0-learning-loop.md`](./plan/p0-learning-loop.md)：早期后端教学闭环与门禁。
  - [`p0-evidence-review.md`](./plan/p0-evidence-review.md)：早期作品证据与验收合同。
- 并行推进任务：
  - [`p1-template-curriculum.md`](./plan/p1-template-curriculum.md)：早期项目模板与课程生成。
  - [`p1-agent-team.md`](./plan/p1-agent-team.md)：早期项目 Agent Team 编排。
  - [`p1-learning-experience.md`](./plan/p1-learning-experience.md)：早期交互体验草案。
  - [`p1-p2-status.md`](./plan/p1-p2-status.md)：早期 P1/P2 状态快照。
- 试点与验证：
  - [`p2-pilot-verification.md`](./plan/p2-pilot-verification.md)：早期试点验证说明。
  - [`p2-release-readiness.md`](./plan/p2-release-readiness.md)：早期发布门槛记录。
  - [`p2-runtime-migration.md`](./plan/p2-runtime-migration.md)：早期运行时迁移说明。
  - [`teaching-routing-redis-verification-20261015.md`](./plan/teaching-routing-redis-verification-20261015.md)：2026-10-15 教学路由与 Redis 验证记录。
  - [`20261017-feishu-reporting-assistant.md`](./plan/20261017-feishu-reporting-assistant.md)：2026-10-17 飞书汇报助手早期方案。

### 2. 管理与平台治理 (`admin/`)
- [`ai-tutor-integration-plan.md`](./admin/ai-tutor-integration-plan.md)：2026-10-12 AI搭档与管理端集成草案。
- [`ui-improvement-plan.md`](./admin/ui-improvement-plan.md)：2026-10-12 管理端 UI 改进计划。
- [`feishu-reporting-bot.md`](./admin/feishu-reporting-bot.md)：2026-10-17 飞书汇报机器人管理端规范草案。

### 3. 设计与视觉案例 (`design/`)
- [`brand-story.md`](./design/brand-story.md)：2026-10-17 品牌故事草案。
- [`pbl-reference-implementation-and-chat-history.md`](./design/pbl-reference-implementation-and-chat-history.md)：2026-10-17 PBL 参考实现与对话历史草案。
- [`pbl-template-team-binding-architecture.md`](./design/pbl-template-team-binding-architecture.md)：2026-10-17 模板团队绑定早期架构。
- [`project-cases-prompts/`](./design/project-cases-prompts/)：2026-10-17 项目案例 Prompt 集合。

### 4. 诊断报告
- [`platform-diagnostic-report-20261016.md`](./platform-diagnostic-report-20261016.md)：2026-10-16 平台端到端诊断快照。
