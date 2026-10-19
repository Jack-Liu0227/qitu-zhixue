# 光学 16 课时项目模板

> Release update (2026-10-19 21:39:47 +08:00): `63e3be8` is deployed, main is synchronized, and migration 0036 is applied. Earlier offline-only statements below describe the pre-release round. Full teaching acceptance and 16-session bootstrap activation are still not complete. [Release evidence](./release-20261019-main.md).

> 状态：2026-10-19，源码与隔离测试实现；未执行生产数据库迁移、模板初始化、绑定激活或部署。Admin 现有阶段编辑器尚不是逐课时编辑器。

## 模板制作方式

一个项目模板承载完整探究，不为每节课创建一个项目。使用现有 `ProjectTemplateSpec` 的 `curriculum.profiles[].sessions` 定义课时，保留原有项目、计划、掌握度和作品评审 owner。

- 新模板 slug：`optics-physical-inquiry-16s`；正文版本：`v2-16s`；profile：`optics-16x60-v2`。
- 排程：8 周，每周 2 课时，每课 60 分钟，总计 960 分钟。
- 内容真源：[curriculum.ts](../../packages/ai-client/src/quiz-bank/optics/curriculum.ts)。旧 `optics-physical-inquiry:v1` 的正文和 bootstrap identity 不变。
- 每课包含稳定 ID、课次、阶段、目标引用、时长分配、学习目标、分活动指导和待提交证据要求。证据要求不是已保存、已掌握或已通过的事实。
- `learningGoal`、`activityGuidance` 和 `evidenceRequirements` 是学生可见的教学说明，不得填写内部系统 Prompt、凭证、标准答案或未脱敏的学生原始对话。
- 课内活动沿用 `review/theory/check/practice/reflect`；只有 `guided_practice` 安排实践分钟。探索与理论阶段只能提供低风险模拟提示。

| 课次 | 阶段 | 主题 | 目标引用 |
| --- | --- | --- | --- |
| 1 | exploration | 光的宏观现象与观察指标 | opt-intent-observe |
| 2 | exploration | 提出探究假设与实验方案 | opt-intent-question |
| 3 | concept_mastery | 光的直线传播与平面镜成像原理 | opt-theory-reflection |
| 4 | concept_mastery | 反射定律公式与光路可逆性 | opt-theory-reflection |
| 5 | concept_mastery | 折射定律与介质折射率定义 | opt-theory-refraction |
| 6 | concept_mastery | 全反射发生条件与临界角推导 | opt-theory-tir |
| 7 | concept_mastery | 凸透镜与凹透镜成像特殊光线作图 | opt-theory-lens |
| 8 | concept_mastery | 理论综合闯关与门禁评测 | 四个既有理论目标 |
| 9 | guided_practice | 光具座搭建、法线与光轴校准 | opt-practice-setup |
| 10 | guided_practice | 折射角与物像距数据采集 | opt-practice-measure |
| 11 | guided_practice | 单缝衍射现象与条纹特征探究 | opt-practice-measure |
| 12 | guided_practice | 封闭细雾室介质散射探究 | opt-practice-measure |
| 13 | guided_practice | 数据线性化拟合与实验求参 | opt-practice-fit |
| 14 | guided_practice | 实验报告撰写与 CER 科学论证 | opt-practice-report |
| 15 | deliverable_review | 实验探究成果答辩与同行质疑 | opt-review-defend |
| 16 | deliverable_review | 学习反思与学科素养成长归档 | opt-review-reflect |

检查点分别位于第 2、8、14、16 课时，只请求现有 owner 校验。不得按课次自动确认意图、开放实践、批准报告或创建成长归档。散射、衍射不加入四目标 `TheoryMastered` 门禁。

## 生成和治理

计划生成器读取服务端解析的具体模板版本正文，而不是把全局课程常量贴上版本 ID。下列请求只生成草稿，`projectId` 仍为 `null`；正式项目创建仍需学生显式确认，并冻结服务端治理绑定。

```json
{
  "interest": "光学探究",
  "weeks": 8,
  "sessionCount": 16,
  "curriculumSlug": "optics-physical-inquiry-16s"
}
```

服务端拒绝未审核排程、歧义 profile、非法课次、目标跨阶段、活动分钟不合计、活动指导指向零分钟活动以及伪造 checkpoint 完成字段。模板结构失败返回 `TEMPLATE_INPUT_INVALID`；生成失败使用 `LEARNING_PLAN_INVALID`；模板或有效绑定不可用为 `CURRICULUM_TEMPLATE_UNAVAILABLE`。权限继续由现有后端对象级策略校验。

初始化仍走现有治理服务和审计流程：[optics-template-bootstrap.ts](../../services/api/src/scripts/optics-template-bootstrap.ts) 的显式 `--curriculum-16s` 路径。该脚本会创建试点并激活绑定，不是预览命令，本次没有执行。它不执行正式验证或发布；同 bootstrap identity 对应不同正文时拒绝复用，要求新建审核版本。

不要用旧 Admin 阶段编辑器重存这个模板正文：它目前写入旧式 `content.phases`，不能替代 `content.pbl.curriculum`。逐课时可视化编辑、学生页面对活动指导的完整展示和实验正式 action/evidence 协议仍需单独接线验收。

## 物理与安全边界

- 临界角采用通式 `sin C = n_2/n_1`，前提为 `n_1 > n_2`；只有第二介质近似空气才简化为 `1/n_1`。
- 折射拟合明确 `x = sin(theta_1)`、`y = sin(theta_2)`，斜率为 `n_1/n_2`。
- 正距离实像约定下，拟合 `1/v` 对 `1/u`，关系为 `1/v = -1/u + 1/f`；虚像及凹透镜须明确其他有符号约定，不使用含糊的“1/u - 1/v 拟合”。
- 区分模型计算、模拟观察与真实测量；Rayleigh 关系仅用于批准域，不把非 Rayleigh 都解释成白色 Mie，不把单色散射变白。
- 课时中的 `interactiveSpec` 不是工具授权，也不代表实验协议已上线。只允许注册模型，实际操作必须再次验证门禁、对象权限、模型版本、参数和 action；真实实验还需教师安全方案。

## 数据兼容与验证

[0036 迁移](../../database/migrations/0036_learning_session_titles.sql) 只增加可空的课时标题列，不回填历史项目语义；旧计划继续使用原显示标题。模板活动说明与证据要求存入既有 `blocks` JSON，并从 API 回读；这些说明不写入掌握度、作品批准或成长事实。部署新 API 前必须按正常发布流程应用迁移；回滚顺序为先回滚应用，再执行对应 down migration。

复核命令：`node tooling/verify-pbl-capability.mjs --focused` 按真实依赖顺序在隔离目录构建并执行相关行为测试，不改写 UNC 安装快照。初始化测试位于 `services/api/src/scripts/optics-template-bootstrap.test.ts`，需另行运行或使用 runner 全量模式。Postgres adapter 测试验证读写映射，不代替真实数据库迁移、生产权限和端到端验收。

审计沿用 `learning_plan.generate`、意图确认、模板和绑定生命周期现有事件，不新增客户端写入路径。验证覆盖课序、阶段、60 分钟合计、12 目标覆盖、四目标门禁、标题与活动回读、幂等草稿、跨学生拒绝、旧模板不改和初始化正文漂移拒绝。

本次 `node tooling/verify-pbl-capability.mjs` 完整运行通过：1040 项 API 测试、78 suites、0 失败，依赖构建、AI 客户端断言与文档检查均通过。详情见[验证记录](../plan/codex/validation-20261019.md)。真实 PostgreSQL 集成因未配置测试数据库未执行，不据此声称 0036 迁移已验收或服务端 main 已同步。
