> 状态：2026-10-28 目录整理；保留原记录日期的方案与实施状态，已完成项和未验证项以正文为准。

# 问答连续学习与末课交付实施记录

2026-10-27。依据[已确认方案](./pbl-continuous-learning-final-delivery-20261026.md)与[实施 Issue](../issues/20261026-dialogue-learning.md)。框架及波动光学八课时试点已上线，教学绑定 active，学生与 Admin 目录可见。完整真实课堂效果尚未验收。

## 学生流程

| 环节 | 新版行为 |
| --- | --- |
| 普通课 | 在 AI搭档主对话直接回答，服务端识别当前任务回应并保存原文；必要证据通过后自动完成课时 |
| 求助与讲解 | 求助不提交错误作答、不覆盖待答题；复习、讲解、课件展示和拓展建议不各自成为完成门槛 |
| 理论检查 | 当前题绑定课时、活动及题目实例；已有掌握度 owner 判定，保留 TheoryMastered 后才能实践 |
| 简短口语 | 新合同中，关键词判错的质化自由回答可以由受治理模型复核含义，仍由答题 owner 保存结果；评价不可用时保持未判分 |
| 实践课 | 预测、运行和观察仍使用批准的实验工具与真实回执；聊天不能伪造观察记录 |
| 过程草稿 | 比较解释等回应持续保存，可在末课汇集；不自动发布为正式成果 |
| 末课交付 | 先进入末课，再整理、确认正文并评价；无需导出再上传。确切作品版本通过后完成简短反思、归档 |
| 右侧面板 | 展示课表、依据和可选团队协作；新版不再要求逐课在这里粘贴、勾选或上传 |
| 失败恢复 | 已保存的评价记录可以重试；请求幂等，旧课时或旧题目的新请求被拒绝；服务故障不冒充学生答错 |

## 合同、门禁与团队

- 新策略为 `lesson-dialogue.v1`，课时显式声明 `progression: dialogue.v1`；旧 `lesson-guided.v1` 不自动改变语义。
- 质量标准增加显式 `required`：必要标准决定通过，提升建议只给反馈。旧合同不接受借此降低要求。
- 新光学治理策略为 `wave-optics-dialogue:v1`。实践阶段出口为 `practice_evidence_ready`，由学习计划必要实践课的完成事实派生；最终作品和归档继续由 Works、Projects 写入。
- 每个实际参与编译的冻结团队都核对阶段门禁及证据 profile；不保留“项目已进入末课，团队还要求提前作品通过”的配置。
- 新团队投影失败不回滚学生证据；后续协调请求恢复投影。可选协作绑定当前可达活动，迟到结果沿用既有范围校验。
- 模型只分类、解释和提出评价候选。客户端不写掌握度、课时通过、作品批准、项目阶段或成长事实。
- 项目确认、冻结版本、Admin 模型与技能配置、知识库交集权限、安全参数域及对象权限保持原责任边界。

没有新建 PBL 状态机、mastery 数据库或数据库迁移。主要改动位于 ai-tutor 的回应适配、learning-plan 的活动/课时检查、Works 的必要标准评价、Projects 的连续学习协调，以及学生端当前任务面板。

后端错误与记录：

| 错误 | 处理 |
| --- | --- |
| `TUTOR_LEARNING_REPLY_INVALID` | 请求缺少有效课时、活动或题目范围，拒绝写入 |
| `TUTOR_LESSON_CHANGED` | 当前课时、计划 revision 或待答题已变化，刷新后重新回应；已保存请求通过幂等回放恢复 |
| `FORMAL_ANSWER_EVALUATION_UNAVAILABLE` | 语义复核没有完成，当前题不计分，保留答案后重试 |
| `LESSON_EVALUATION_UNAVAILABLE` | 已保存的普通回应、观察或作品暂未评价，重试同一记录 |
| `TEACHING_BUNDLE_INVALID` / `DIALOGUE_TEAM_GATES_MISMATCH` | 教学团队与新版门禁不一致，Admin 修复后才能启用，不记为学生未达标 |

对象权限继续在 owner 校验；回应适配器也校验学生本人、项目、计划版本、当前活动和待答题。语义复核审计记录策略、模型来源和候选判定，阶段迁移沿用审计与 outbox；可选团队同步失败仅记有界警告，不写原始学生回答到日志。

## 试点课程

新模板标识 `pbl-wave-dialogue-inquiry`，版本 `v1-8s-dialogue`，目录 slug `wave-interference-diffraction-8s-dialogue`，排期 `wave-optics-8x60-dialogue-v1`，独立 bootstrap identity `wave-interference-diffraction:8s-dialogue-v1`。

| 课次 | 必要产出 |
| --- | --- |
| 1 | 一次切题的探究问题回应 |
| 2 | 既有三个必要理论目标的真实检查结果 |
| 3–6 | 已运行并保存的单缝/双缝模拟观察，第 4、6 课各需两条，共六条 |
| 7 | 基于前序观察的一段比较解释，保存为过程草稿 |
| 8 | 确切版本的最终档案通过必要评价，再完成一次简短反思 |

模拟结果不标为真实测量。新合同没有扩大旧光学实验模型或知识授权。其他模板、历史冻结绑定与完成记录不迁移；编程课程的可信运行验证仍是单独工作，不能以本次光学试点代替。

## 验证

验证快照使用远端现有源码加本任务 52 个文件，在隔离目录 `/tmp/qitu-dialogue-release-20261027-t7j8exy7` 构建；外部依赖来自已安装版本，内部包按依赖图重新编译，不依赖旧 dist。

- `node tooling/verify-tutor-lessons.mjs --current`：18 项构建/检查通过。API 行为测试 341 项，0 失败；包括八课时 owner 全流程、求助、幂等恢复、陈旧范围拒绝、必要/建议标准分离、末课可达、作品精确版本、理论门禁、旧模板及团队权限回归。
- 三端类型检查、学生数据与 SSE 请求边界、AI client 断言和 30 项团队 worker 测试通过。
- 真实 Nest 应用依赖图启动与 HTTP health 测试通过；新 bootstrap 模块也完成无数据库隔离启动检查。
- 真实 React 组件浏览器 fixture 验证：普通课无额外表单，末课正文交付，评价恢复，错误恢复，390px 无横向溢出；浏览器异常为 0。数据源为合成替身，不能替代线上课堂验收。
- 修正既有题库断言遗漏 inspiration 题库的范围，未改变其生产评分规则。测试快照中的 Admin 工具参数 import 一度处于并行编辑中，最终发布候选已通过类型检查，未覆盖该并行工作。

模型质量测试中的受控 evaluator 只验证 owner 决策与边界。隔离 fixture 可以使用已知答案，但没有向生产注入 mastery、TheoryMastered、作品通过或学生完成记录。

构建与测试原始记录：[18 步验证](../issues/assets/20261027-dialogue-learning/verification.json)、[正式构建](../issues/assets/20261027-dialogue-learning/build-report.json)、[组件浏览器结果](../issues/assets/20261027-dialogue-learning/browser-fixture.json)。组件截图为合成数据：[普通课](../issues/assets/20261027-dialogue-learning/ordinary-fixture.png)、[末课手机视图](../issues/assets/20261027-dialogue-learning/final-mobile-fixture.png)。bootstrap 脚本随后补充当前策略引用和中断草稿恢复，额外通过 API 类型编译及真实 owner 启用、幂等回读，不将此前 341 项测试描述为覆盖这段后续代码的全部情况。

全仓文档链接检查仍报告 14 处既有缺失目标，涉及历史灵感方案、旧项目修复和视觉资源归档；本次新增实施记录与证据链接均可解析，未恢复或改写其他任务的归档内容。

## 发布与真实请求

截至北京时间 2026-10-27 01:18，生产仍运行于 `/root/qitu-zhixue`，沿用既有 systemd 单元；没有新增生产目录。本次按清单发布 52 个功能文件及构建，未提交或推送 Git。

| 事实层 | 回读结果 |
| --- | --- |
| 源码与运行代码 | 52 个本任务源码文件与本地 SHA-256 一致；核对 703 个运行产物，其中并行 MCP 更新的 4 个差异已单独验证，没有未解释差异 |
| 模板 | `tpl-f950fdce-fbfb-44b1-b140-c85f66aae25b`，`piloting` |
| 模板版本 | `tplv-55d940f7-24f8-4740-b5ff-258259b3d3bf`，`piloting`，冻结 `lesson-dialogue.v1` 及八课时 profile |
| 教学绑定 | `bnd-07b0f905b332691d`，`active`；digest `aa66d9e729db1b3fb7a433ef721b14ea2b071cd513103171bad13b30221e6c7e` |
| 策略与授权 | 新绑定采用当前策略版本 `5c0871ec3fdc`；仅保留源绑定已有模型组合、工具、知识库和 canonical skill ID，已撤权技能拒绝；本次实际刷新技能摘要数为 0 |
| 幂等回放 | 再次执行 bootstrap 复用同一模板、版本、团队和 active 绑定，无重复配置 |
| 学生端构建 | `eObdp_d_v3TEMV_z97ly0` |
| Admin 当前构建 | `5_3CWbMP42UKkdqWSmWvV`，包含随后并行发布的 MCP 改进；本次最初构建为 `Ae-0yd3OtGB4_hkIIqMiC` |
| 服务与资源 | 八个服务 active，工作目录均为主工作树；数据库/Redis ready；六个页面返回 200，80 项 JS/CSS 资源通过，匿名 Tutor 访问返回 401 |
| 线上浏览器 | 既有学生与 Admin 演示账号登录后均看到新课程；390px 学生入口可见，脚本异常为 0；没有创建项目 |
| 真实模型 | 经 Admin `learning.evaluate` 路由使用 `deepseek / deepseek-flash`，合成内容的求助识别、操作提问排除、必要标准评价和同义表达复核通过；没有写学生学习事实 |

记录：[发布源码清单](../issues/assets/20261027-dialogue-learning/release.json)、[初次成功切换](../issues/assets/20261027-dialogue-learning/release-initial.json)、[启用幂等回读](../issues/assets/20261027-dialogue-learning/activation.json)、[数据库只读回读](../issues/assets/20261027-dialogue-learning/final-readback.jsonl)、[真实模型](../issues/assets/20261027-dialogue-learning/real-model.json)、[线上浏览器](../issues/assets/20261027-dialogue-learning/browser-live.json)、[最终服务与产物核对](../issues/assets/20261027-dialogue-learning/final-audit.json)。

发布前只读回读：现有波动光学八课时课程采用 `lesson-guided.v1`，active 绑定 `bnd-8e056bfef49a4728`，单团队、无 sessionAssignments；线上已有项目 31 个，新问答模板 0 个。本次 bootstrap 只接受显式源绑定与有效 Admin 身份，不按团队名称猜路由，不静默迁移多团队教学安排。

发布后旧绑定仍为 active、`lesson-guided.v1`；项目总数仍为 31，新问答模板项目为 0。试点不伪装成正式课堂验证通过，bootstrap 没有调用 `template.version.verify` 或 `template.version.publish`。历史项目不会因为新版出现而自动切换合同。

## 发布恢复与并行修改

首次切换时，临时发布脚本把 infra 中的 `cache` 代码目录误当成 Next 构建缓存排除，API 无法启动并触发回退。补齐代码目录，收窄到仅排除 `.next` 根目录的构建缓存，并在启动前逐文件校验输出后重新发布成功。后续类型编译期间服务器发生 OOM，构建退出 137，SSH/HTTP 暂时超时；清理本任务隔离构建缓存后恢复，最后一次 API 编译使用 1 GiB Node heap 上限并通过。最终健康与资源检查在恢复后执行，不把中途失败当作成功。

真实配置启用还暴露了 `undefined`/`null` 的非实践阶段 profile 表达差异，以及旧来源绑定的策略版本。前者按空值等价修复且补充回归；后者仅更新新模板未启用草稿的当前策略/已授权技能版本，其他权限引用必须一致，否则拒绝覆盖，已激活绑定和历史项目不会被重写。

完整切换前备份：`/var/backups/qitu-dialogue-20261027-005020`；API 后续修复备份：`/var/backups/qitu-dialogue-20261027-005624`。先停受影响服务再按备份范围恢复；新模板已有学习项目时不能直接回退到不支持新合同的代码。新模板停用须走 Admin 退役/归档 owner，保留记录，不删除项目或手工改 mastery。

工作期间保留账号注册、经营后台、家长页面、Admin 成员编辑器及知识工具配置等并行修改。最后并行提交 `59bee84806b7f22ee816eb8e29a48779f97beb64` 更新了 `legacy-mcp-catalog`、`platform-registry.service`、`knowledge-tool-catalog.service`、`knowledge-center.service` 四个运行模块及 Admin 页面；将这四份实际运行代码放入隔离测试输出后，42 项相关回归全部通过，见[独立验证](../issues/assets/20261027-dialogue-learning/concurrent-runtime-tests.json)。本次没有覆盖这些更新，也未宣称其全部外部 MCP 连接均经过验收。

旧项目继续沿用冻结合同。源码完成、试点配置激活、真实模型可用与完整课堂效果是不同结论；没有真实课堂证据时不将模板标为正式验收通过。
