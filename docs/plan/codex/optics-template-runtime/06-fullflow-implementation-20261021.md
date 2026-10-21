# 光学模板全流程实施与验收（2026-10-21）

> 状态：光学 v3 源码及隔离闭环验证通过；本次生产发布结果另记部署记录。（2026-10-21）

本轮接通光学项目的课时、理论考核、实验观察、作品送审和最终反思。配置管家 skill 由另一项任务维护，本轮不修改 `.agents/skills/qitu-project-configurator`。

## 学生和教师的实际路径

1. 学生在灵感空间选择“与 AI 搭档开始”时只创建探索会话。讨论后在 AI 搭档中显式确认意图，才创建正式项目。
2. 确认事务同时冻结模板、绑定、团队和教学合同，并从该冻结模板创建一份 active 学习计划。确认返回后，AI 搭档即可读取首课。
3. AI 搭档中的课时任务区保存学生的本课回应。理论课的“检查我的理解”调用已有出题、判分和掌握度 owner，返回题目及作答解析。模型生成的巩固题仍是 formative，不直接授予 TheoryMastered。
4. 理论达标后，Agent 可在授权课时调用受限教学工具生成实验卡片。第 11、12 课分别保存单缝衍射和封闭细雾室散射的预测、运行和模拟观察。滑块计算结果不能代替观察证据或真实测量。
5. 第 14 课在对话中提交报告正文并申请审核。当前班主任在原有学生详情抽屉中读取精确送审版本，然后给出审核决定。学生刷新、查看作品并发布已审核版本。
6. 第 16 课提交最终反思，并引用同项目已审核发布的报告。服务端核验后记录课时完成，再由 projects owner 核对并归档项目与计划。

右侧完整课表与当前任务读取同一套冻结课表和课时完成记录。对话、作答、实验操作和课时完成后会刷新项目上下文；失败保留重试入口。旧的任务完成按钮不再调用项目阶段 advance。

## 新版本的语义边界

- 模板 slug：`optics-physical-inquiry-16s-completion`。
- 模板 spec：`pbl-optics-inquiry-16s-completion` / `v3-16s-completion`。
- 排期 profile：`optics-16x60-v3`，共 16 课，每课 60 分钟。
- Bootstrap identity：`optics-physical-inquiry:16s-v3-completion`。
- 旧 v1、v2 内容不变；旧项目不会在读取时获得新完成规则。

新增 `completionSpec` 属于 ProjectTemplateSpec 的版本化教学合同。它只规定本课所需的证据和掌握目标，不另建 mastery 或项目状态机。

| 课时 | 完成依据 |
| --- | --- |
| 1–2 | 本课已保存的回应或探究表达 |
| 3–7 | 本课回应及其理论目标的有效掌握证据 |
| 8 | 本课回应及四个既有理论目标的有效掌握证据 |
| 9–10 | 理论门禁成立后的本课探究表达 |
| 11–12 | 精确课时、计划 revision、目标范围内的已保存模拟观察 |
| 13 | 理论门禁成立后的本课数据分析表达 |
| 14 | 本课提交报告与当前导师批准的同一不可变版本，且已发布 |
| 15 | 本课答辩或修订表达，以及进入复盘所需的已批准报告 |
| 16 | 真正的最终反思记录与同项目已批准发布的报告 |

共享目标不会跳过课时。例如第 3、4 课共享反射目标，第 10、11、12 课共享测量目标，但每一课仍需自己的任务证据。第 8、14、16 课的检查点均不会自动产生通过事实。

## 服务端责任与接口

所有接口仍执行服务端身份、对象和冻结版本校验。写接口使用稳定幂等键，前端收到回执后才显示已保存。

| Owner | 接口或内部调用 | 写入事实 |
| --- | --- | --- |
| projects | 确认意图、`POST /projects/:id/reconcile-learning` | 正式项目、冻结快照、经核验的项目阶段 |
| learning-plan | `attachConfirmedProjectPlan` | 确认事务内的 active 计划和冻结课表投影 |
| learning-plan | `GET /learning-plans/:id/progress`、`POST /learning-plans/:id/sessions/:sessionId/complete` | 独立课时完成凭据 |
| learning-plan / mastery | `POST /tutor/projects/:id/lesson/assessment`、其 `/answers` | 既有 pending question、真实判分与掌握证据 |
| works | 本课 `/responses`、`/artifacts`、`/reflections` 及 `/evidence` 读取 | 正文版本、可核验引用、最终反思 |
| ai-tutor / works | 原有实验 action 接口 | 参数域内的 action、模拟观察和 CER/rubric 引用 |
| teacher / works | `GET /teacher/students/:id/reviews`、原有审核决定与发布接口 | 当前导师对精确送审版本的决定及作品发布 |

接口完整前缀是 `/api/v1`。本课写入携带 `planRevision`；完成请求还携带 `projectId` 和引用。写入字段由白名单约束；课时完成和考核接口拒绝未知字段。伪引用、跨对象、陈旧 revision、越过当前课时或缺少真实证据都会被拒绝。

`submitEvidence` 现在只核验、记录提交，返回 `assessment_required` 和 `masteryUpdated: false`，不把任意字符串转换成正确答题或掌握事实。实验的 `block.objectiveId` 继续标记注册模型域，`scope.objectiveId` 才标记冻结计划的实际学习目标。

课时正文复用 Works 的不可变版本和受控文本封装。无需虚构文件上传或依赖尚未配置的对象存储。学生可刷新后重新读取正文；教师只能查看其当前负责学生的送审版本。后续文件附件能力仍需真实对象存储配置。

数据库新增 `0045_learning_session_progress` 及 down migration，唯一约束为 `(plan_id, plan_revision, learning_session_id)`。历史 revision 记录保留。Journal 保留其他任务已登记的 `0044_feishu_message_bridge`。

主要错误处理如下；所有对象和版本都必须重新由服务端读取，不能仅在前端改状态。

| 错误码 | 含义与处理 |
| --- | --- |
| `LEARNING_SESSION_FORBIDDEN` / `LEARNING_EVIDENCE_FORBIDDEN` | 403，非本人或当前导师，停止读取或写入 |
| `LEARNING_SESSION_SCOPE_STALE` / `TUTOR_LESSON_CHANGED` | 409，重新读取项目与计划 revision |
| `LEARNING_SESSION_OUT_OF_ORDER` | 409，回到服务端返回的当前课时 |
| `LEARNING_SESSION_REQUIREMENTS_UNMET` | 409，展示 blockers，补齐真实证据 |
| `THEORY_MASTERED_REQUIRED` | 理论门禁尚未成立，继续理论学习和考核 |
| `PROJECT_REVIEW_REQUIRED` | 先完成当前导师对精确报告版本的审核与发布 |
| `PROJECT_TEACHING_PLAN_UNAVAILABLE` | 确认失败并回滚，由 Admin 修复教学合同后重试 |
| `LEARNING_PROGRESS_OWNER_REQUIRED` | 新课时合同禁止走旧项目 advance 入口 |
| `ARTIFACT_INLINE_TEXT_INVALID` | 400，检查正文长度和纯文本格式 |

## 验证分层

可重复运行：

```powershell
node tooling/verify-pbl-capability.mjs --optics
```

该模式按依赖顺序构建 contracts、database、infra、agent-memory、ai-client 和 model-runtime，再检查 API、相关 owner 行为、SDK/课程合同以及学生/教师应用类型。包产物使用本次独立输出，避免 UNC 安装快照覆盖源码事实。它不执行全站文档审计或配置管家测试；这些结果必须分别记录。

- `optics-fullflow.test.ts` 用真实业务 owner 连续完成 16 课：实际多轮题目判分、实验动作/观察、报告送审、TeacherService 审批、Works 发布、最终反思、课时完成与项目归档。测试答案由服务端测试 oracle 读取，不向学生暴露答案，不直接注入 mastery、通过状态或阶段。
- `projects-confirmed-plan.test.ts` 覆盖确认前无项目/计划、确认后立即有冻结计划、幂等和失败回滚。
- PostgreSQL 隔离测试脚本 `tooling/test-optics-confirmation-postgres.cjs` 要求 `QITU_DATA_MODE=test`、`QITU_DISPOSABLE_FIXTURE=yes`、loopback 地址和专用新库名。它创建并最终删除自己的数据库，覆盖 46 个迁移、真实 AppModule 启动、两种确认入口、并发和事务回滚。12 项验证通过，没有注入 mastery 或实践阶段。
- 浏览器使用显式合成 HTTP fixture 检查真实页面交互。它只证明前端合同、状态和刷新行为，不证明真实模型或 IMA 可用。

最终执行数量与结果见同目录 `07-fullflow-verification-20261021.json`。测试中的学生、导师和内容均为隔离合成数据。

本轮隔离验证通过 596 项相关 API 行为检查、12 项真实 PostgreSQL 确认事务检查和 8 项浏览器交互检查；学生、教师应用类型检查与 11 项前端定向测试通过。

写回后的原 UNC 目录也执行了同一验证命令。依赖包构建完成，但 API 编译被并行工作阻断：`feishu-socket.factory.ts:2` 找不到已在 package manifest 声明的 `@larksuiteoapi/node-sdk`；`platform-registry.service.ts:1180–1183` 将 `readonly string[]` 传给要求可变数组的 Drizzle `inArray`。这些路径及原 `node_modules` 不属于本轮光学修改，没有覆盖。对应维护任务需同步依赖，并修正这四处数组参数后重跑原目录验证。因此本轮不宣称当前全仓构建通过。

## 部署与真实运行仍需满足的条件

本轮未修改生产数据库、未激活线上模板、未读取供应商密钥，也未调用生产模型。部署时先执行迁移，再在 Admin 治理链路中建立新 v3 模板和 Teaching Bundle。现有 bootstrap 会创建或复用该新版本、试点并校验绑定，不替代正式发布与教学验收。

团队成员必须真实存在；冻结 roleMap、`(modelProviderId, modelId)`、发布的技能 pin、工具和知识范围。启用 `pbl-dynamic-lesson` 与 `tutor.propose_lesson_activity` 后，Agent 才能调用动态课件工具。IMA 同时受冻结 grant、当前全局授权、助手工具和项目对象权限约束，缺范围默认拒绝。

上线验收还要使用实际学生/教师账号，验证真实模型生成的板书、实验和知识库巩固题，以及团队运行记录、服务端门禁和失败恢复。当前报告不把合成目录、内存 TeamRuntime 的拒绝日志或浏览器 fixture 当成线上团队执行成功。
