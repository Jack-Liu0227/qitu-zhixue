# PBL 能力链架构与实施入口

> 状态：2026-10-26 完成入口整理。此页提供当前责任域及历史方案的导航，不汇总宣称功能完成或生产验收。

## 当前规则与近期实施

学习阶段、评价、作品与成长事实由服务端 owner 写入，Admin 统一控制运行时。当前产品合同先读 [文档总入口](../../README.md)、[自主学习与教师只读](../../issues/20261024-autonomous-learning.md)、[AI搭档](../../student/tutor.md) 和 [平台治理](../../admin/platform-governance.md)。

- [项目问答与课件交互修复](./interaction-remediation-20261024.md)：按文内矩阵区分完成项和开放项。
- [新增八类项目方案](./inspiration-eight-project-expansion-20261024.md)与[实施记录](./inspiration-eight-project-implementation-20261024.md)。
- [课时助手与团队绑定](./template-session-bindings-20261023.md)。
- [课程团队与干涉衍射专题](./tutor-course-team-redesign-20261022/README.md)。
- [知识中心配置矩阵](./knowledge-center-config-matrix-20261022.md)、[画像与成长运行时](./profile-growth-runtime-20261022.md)。
- [教学配置界面设计](./teaching-profile-ui-20261022.md)与[验证边界](./teaching-profile-ui-verification-20261022.md)。
- [技能生命周期](./skill-lifecycle-20261022/README.md)。
- [逐课录屏验收](../../issues/20261024-recorded-journeys.md)及[全部问题与验证记录](../../issues/README.md)。

## 2026-10-19 至 21 日设计与验证基线

以下材料从 Git 历史恢复，保留原日期、来源锁和验证边界；其中“当前”“尚未完成”等措辞指原记录日期。不可用历史数字、旧教师审批方案或旧团队版本资源覆盖后续产品修订。

| 主题 | 入口 |
| --- | --- |
| 架构与计划 | [总架构](./architecture.md)、[实施计划](./implementation-plan.md)、[差距审计](./gap-audit-20261019.md) |
| 教学与治理 | [Theme/Session/Team 合同](./theme-session-team-ima-design.md)、[技能目录](./skills-catalog.md)、[MCP 治理](./mcp-tool-governance.md) |
| 光学与成长 | [光学模型方案](./optics-scattering-diffraction-analysis.md)、[光学模板运行时](./optics-template-runtime/README.md)、[画像成长投影](./profile-growth-projection/README.md) |
| 研究与证据 | [研究报告](./research-report.md)、[来源锁](./source-lock.json)、[原交付状态](./delivery-status.json)、[原验证](./validation-20261019.md)、[发布基线](./takeover-validation-20261019.md) |
| 配置与运行时 | [Agent 教学需求](./agent-driven-pbl-requirements-20261021.md)、[SDK 审计](./skills-mcp-tools-sdk-audit-20261021.md)、[加载优化](./runtime-governance-optimization-20261021.md)、[管家模块](./copilot-module-references-20261021.md)、[管家生命周期](./copilot-lifecycle-verification-20261021.md) |
| 视觉素材 | [素材库与验证](./visual-assets/README.md) |

## 恢复与归档

- [恢复清单](./recovery-manifest-20261026.json)记录原提交和原文件 SHA-256。补充的历史状态说明不改写原验收事实。
- [整理前入口、旧测试稿与参赛稿](../../archive/repository-cleanup-20261026/README.md)按原字节保留。
- [能力链更新前快照](../../archive/codex-before-capability-20261019/README.md)及[更早规划](../../archive/pre-20261018/README.md)继续仅作历史证据。
- [历史学生数据修复](./student-entry-history-repair-20261021.md)和[历史清理记录](./student-permanent-cleanup-20261022.md)仅用于审计，不作为日常操作脚本。

文档检查：`python3 -B tooling/validate-docs.py`、`node tooling/check-codex-plan.mjs`。它们验证链接、状态声明和归档完整性，不证明当前业务、模型请求或学习效果。
