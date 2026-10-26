> 状态：原日期的方案或验证记录；2026-10-26 整理仅补充分类与引用，不新增功能完成或生产验收结论。

# 零基础教学与课件资产：实现与部署记录

2026-10-23：代码、数据库迁移、学生端和 Admin 界面已同步并部署到 `study-remote` 的 `/root/qitu-zhixue`。新八课时课程已配置为 **piloting**，教学绑定为 **active**。真实师生课堂评价尚未完成，未调用模板的 verify/publish，不能把自动化验收描述为学习效果证明。

## 对应计划的实现

| 计划 | 已实现行为 |
| --- | --- |
| P0 教学合同 | 新冻结版本为八课时配置 `zero-base.v1`，明确概念、来源和教学展示回执；旧版本不自动升级。 |
| P1 先教再测 | 提示词按知识库讲解、分步演示、检查与补救组织教学；本课教学回执不足时，直接请求正式题目也会被 owner 拒绝。待答题继续优先，形成性题目不能写 mastery。 |
| P2 课件恢复 | PostgreSQL 保存精确内容、来源校验值、课程 hash、模型/技能版本与阅读位置；跨请求重新核验来源和权限；继续学习只确认教学展示，不等于掌握。 |
| P3 资产治理 | 项目生成内容进入去除身份元数据的候选库；Admin 预览、修订为子版本、逐项审核、发布和撤回。已发布内容通过新版本修订。 |
| P4 选择与复用 | 按课程 hash、目标、用途与当前知识授权筛选；复用要求重新读取来源；改编保留父版本和来源。反馈只记录有界类别及次数，不生成学习效果分数。 |
| P5 工程验收 | 新团队与模板绑定、八课时 owner 行为测试、浏览器恢复与审核流程、真实知识库和模型的隔离调用已验证。真实课堂试点评价仍待完成。 |

学生端继续使用 AI搭档及现有课时面板。新模式进入课时时自动展开学习面板，支持翻页、恢复位置、再解释、看例子和问题反馈；进入可考核活动后显示正式考核入口。Admin 使用现有“模型与设置 → 知识库”页面的课件资产区，没有新增顶层导航。

公开复用前仍需管理员实际完成科学、教学、展示、隐私和来源许可五项审核。候选内容不等于已审教材；本轮没有把合成测试课件发布到生产资产库，也没有生成生产学生的 mastery、通过作品或课程完成记录。

## 主要代码入口

- 合同与新课程：`packages/contracts/src/courseware.ts`、`packages/contracts/src/courseware.validation.ts`、`packages/ai-client/src/quiz-bank/optics/wave-teaching-curriculum.ts`。
- 教学与来源：`services/api/src/modules/ai-tutor/tutor-courseware-activity.ts`、`tutor-courseware.service.ts`、`gateway-tutor.provider.ts`、`services/api/src/modules/knowledge/knowledge-retrieval.service.ts`。
- 内容 owner：`services/api/src/modules/knowledge/courseware.service.ts`、`courseware.store.postgres.ts`；迁移 `database/migrations/0049_courseware_assets.sql`。
- 进度接线：`learning-plan.service.ts`、`learning-session-progress.service.ts`、`lesson-activity-progress.ts` 与 `works-learning-evidence.service.ts` 读取同一份教学回执。
- 学生端：`LessonCoursewareCard.tsx`、`LessonLearningDock.tsx`、`LessonAssessmentCard.tsx`、`lessonProgressApi.ts`。
- Admin：`apps/admin-console/lib/components/knowledge-library/CoursewareLibrary.tsx`。
- 幂等配置入口：`services/api/src/scripts/zero-base-courseware-bootstrap.ts`。

本轮同时修复了独立正式题目被历史累计答题次数持续扣分的问题：每个只能接受一次答案的题目实例按一次作答记录；掌握阈值与置信度上限保持原规则。还修复了作品提交遗漏教学回执、前端进度未识别 `teaching_delivery`、HTTP 环境下审核幂等键生成失败，以及模型收到笼统工具错误后无法修正候选的问题。

## 权限、错误与审计

Admin 候选列表、创建和审核由服务端验证管理员身份；学生课件接口验证项目所有者、当前计划/课时/活动及冻结工具权限。恢复与继续学习均重新检查来源授权；已有待答题时不能通过课件入口跳题。

主要错误码：`COURSEWARE_ADMIN_REQUIRED`（非管理员审核）、`COURSEWARE_NOT_AUTHORIZED`（目标、来源或授权不匹配）、`COURSEWARE_CONTEXT_CHANGED`（当前课时变化）、`COURSEWARE_WITHDRAWN`（关联版本撤回）、`COURSEWARE_REVISION_CONFLICT`（并发修订冲突）、`COURSEWARE_REVIEW_INCOMPLETE`（审核项不完整）及 `TEACHING_DELIVERY_REQUIRED`（尚未完成本课教学展示）。前端显示失败或提供重新加载入口，不提前显示写入成功。

审计记录使用既有 owner 的 `courseware.create`、`courseware.review`、`courseware.delivered`、`courseware.position`、`courseware.feedback` 动作；写入使用范围化幂等键和事务。反馈只记录限定类别与次数，不复制原始学生对话。

## 验证证据

最终远端源构建验证运行：`run-1792750448309-2310356`，2026-10-23 18:15:43（北京时间）结束，18 个步骤通过。

| 验证 | 结果与边界 |
| --- | --- |
| API 行为 | 324/324；包含新旧八课时、权限撤销、待答题保护、正式 mastery、实验观察、作品和最终反思。师生决策在可丢弃 fixture 中通过真实 owner 执行。 |
| 学生数据适配器 | 17/17；另有实时与服务端边界测试 7/7。 |
| 后台团队任务 | 30/30。 |
| 构建与类型 | 按 contracts、database、infra、agent-memory、ai-client、model-runtime 构建；API/worker 构建、SDK 断言和学生/教师/Admin 类型检查通过。 |
| PostgreSQL | 0049 在隔离 schema 事务中验证并回滚；真实 PostgreSQL store 的保存、重放、反馈、审核、项目级联清理也通过回滚 fixture。之后正式迁移从 0048 应用到 0049。 |
| 浏览器 | 实际生产前端配隔离 API fixture：翻页、刷新恢复、继续回执、反馈、待答题遮蔽、403、审核发布、撤回通过。5 次写请求均被 fixture 接管，生产写入为 0。检查了桌面与手机视口。 |
| 真实知识库与模型 | 使用新绑定的冻结授权、当前实际助手和 `deepseek / deepseek-flash`；检索得到 3 条实际资料、核验 1 次读取，模型经候选纠正生成并保存 1 份 board。学习 store 为内存 fixture，生产学习写入为 0。此项不是八课时真实学生验收。 |
| 部署 | API 以 postgres 构建运行；学生/Admin 分别停止、重建并启动；实际工作目录仍为主仓库。学生页面 18 个、Admin 页面 14 个 CSS/JS 引用检查通过。 |

回归入口：`node tooling/verify-tutor-lessons.mjs --current`。远端报告为 `services/api/.tmp/pbl-capability/verification.json`；发布日志、源文件备份和构建备份位于 `.codex-tasks/courseware-deploy-1792748251/`。浏览器使用 Playwright 隔离请求；不使用生产账号学习记录进行造数。

验证过程中发现旧 SDK 断言错误地限定所有助手只能使用一个技能，已改为检查 canonical ID 形式及默认技能属于启用集；SDK 默认不暴露全局目录的行为断言仍保留。远端部分既有 Admin 源文件仅 root 可读，前端验证按实际运行账号进行；没有更改这些源码或密钥的权限。仅修正构建输出目录归属。

## 已配置身份与运行边界

| 项目 | 回读结果 |
| --- | --- |
| 模板 slug | `wave-interference-diffraction-8s-zero-base` |
| 模板版本 | `tplv-e6e78f26-9943-4450-adb7-67a9f288cc40`（版本 v2，piloting） |
| 课程规格 | `v2.1-8s-zero-base`，排程 `wave-optics-8x60-zero-base-v1` |
| 团队 | `team-wave-optics-zero-base` |
| 团队版本 | `team-version-19932d5641ef882926993c31deb624f8` |
| 教学绑定 | `bnd-8e056bfef49a4728`（active） |
| 新技能 | `pbl-courseware-guidance` 1.0.0，published；digest `a224380c48e3f8c845e1af760ac396a62adfc3db138354d8a176286fa554ef56` |

技能按 [qitu-skill-creator](../../../../.agents/skills/qitu-skill-creator/SKILL.md) 的既有 `skill.create` / `skill.publish` owner 发布，并回读目录、助手授权和新团队版本。未覆盖旧技能内容或历史项目 hash。

首次配置尝试发现原团队当前 PBL 工作流为空，因此使用其已发布快照创建独立团队。第一份未通过绑定编译的试点草稿保留为历史诊断记录，未激活；最终生效的是上表中的新版本。既有课程和历史项目不被静默迁移。工作区中的并行课时绑定及后台修改已保留，本轮没有替其宣称完整验收。

后续正式发布仍需要真实师生试点的教学质量与学习效果评价，并走已有模板治理流程。当前代码可支持生成、保存和审核复用；资产库的生产候选应来自实际授权教学，不能由测试样本伪造。
