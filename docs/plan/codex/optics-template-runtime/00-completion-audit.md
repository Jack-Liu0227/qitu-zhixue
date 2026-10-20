# 问题一完成情况报告

> 状态：2026-10-21 / 已完成本轮代码审计；业务尚未全部完成，未作生产验收。

日期：2026-10-21（Asia/Shanghai）。源码：`61d28fd` 加已有工作树改动。

**结论：没有全部完成，不能按用户描述进行完整交付验收。** 页面和多段后端能力已存在，但管家管理、配置发布、课时运行与知识库练习之间仍有明确断点。

## 判定范围

- “已实现”表示找到调用链；通过本轮测试的项目另列证据，不等于线上验收。
- “部分实现”表示有能力但未满足完整用户行为；“未接入”表示所查入口缺少必要接线。
- 本轮未查询生产配置、调用真实模型/MCP 或修改学生数据；发布、启用、真实请求和教学效果均未核验。
- 行号基于本次代码基线。01–05 文件为既有设计或先前验证，当前结论以本报告及 [本轮验证](./08-validation-20261021.md) 为准。

## 用户要求逐项核对

| 要求 | 判定 | 当前实现与缺口 |
| --- | --- | --- |
| 管家选择已添加项目 | 未接入 | 选择器读取 assistants/teams，没有模板/项目实例目录及对象上下文 |
| 管家创建助手、团队 | 部分实现 | 有真实创建调用；组合创建可能部分成功，缺统一操作记录与恢复 |
| 修改当前项目全部配置 | 未接入 | 关键词创建分支没有按选中项目执行的统一修改、差异和版本发布链 |
| 管家创建工作流 | 未接入 | 模板设置有 workflow 编辑标签；管家无对应命令，应复用已有团队 workflow |
| 创建 Skill、MCP、模板、知识库 | 草稿能力 | 页面明确返回 draft only，没有正式创建/发布调用 |
| 管家配置模型 | 部分实现 | 供应商/模型二元组用于新助手；无管家 provider 创建及既有项目用途更新链 |
| Skills 驱动管家 | 未接入 | `handleSend` 仍为客户端 `setTimeout` + `includes`；目录未发现管理 Skill |
| 测试选中助手 | 未满足 | 非默认助手按 ID 返回固定文案，工具步骤本地构造 |
| 光学配置及修改技能、MCP、KB、成员、模型 | 部分实现 | 独立管理页和 bundle 草稿 API 存在，统一编辑/编译/发布/消费未闭环 |
| 自由探索由启途智学助手处理 | 已有主链 | Tutor 使用 `qitu-intake-assistant`，真实模型请求本轮未验证 |
| 按兴趣推荐、选择、确认项目 | 已有主链 | published 模板筛选排序、服务端幂等确认、前端边界测试已存在 |
| 确认后模板/团队接管 | 部分实现 | 团队快照和 digest 字段存在；新 bundle 发布断开，全部能力未从冻结包解析 |
| 按模板课时完成 PBL | 部分实现 | 有课时合同和计划生成器；对话作者按项目阶段选，课时路由函数无生产调用 |
| 对话内拖参数、全屏 | 已有组件 | 衍射/散射卡有 range/Fullscreen；未做真实浏览器验收，不等于全课时课件齐全 |
| 理论后根据知识库生成巩固题 | 未形成闭环 | 可评分题来自静态 quiz-bank，未接带知识来源的动态生成 |
| AI 团队判断并给完整解析 | 未满足 | 当前题库判分且解析有披露门禁；未接团队候选评阅与 owner 采纳 |
| 右侧团队状态、历史、工具调用 | 部分实现 | 有安全投影，只读最新 run/成员最近 20 条，无完整历史分页；Worker 不执行工具 |
| 右侧阶段/课时与模板统一 | 部分实现 | 阶段来自团队 pblSpec，当前课时来自 learning-plan；尚非完整统一课时视图 |
| 实验结果形成学习证据 | 部分实现 | 有动作、参数门禁和审计，没有 observations owner 回执/CER/rubric 闭环 |

## 主要缺口与证据

### A1：管家仍是客户端规则分支

`apps/admin-console/app/(console)/copilot/page.tsx:350–420,638–779`：

- `setTimeout` 按关键词执行，同一句包含团队/Skills/MCP 时只进入一个分支。
- 助手/团队创建会调用服务端；MCP/Skill/模板/KB 仅生成草稿。
- 非默认助手按 ID 包含 `coach`、`guide` 等返回固定回复，不能证明真实调用。
- `toolSteps` 包含本地构造的 schema、安全检查 `done`，不是服务端执行证明。

影响：一句“给光学配置团队、技能和知识库”不能完成全部操作。任务：OPTICS-008/009/010。

### A2：编译器及写入钩子未接入发布链

`services/api/src/modules/templates/teaching-bundle.compiler.ts:182` 有纯编译器；`templates-binding.service.ts:148–231` 有草稿读写及 `attachCompiledTeachingBundle`。

排除测试后搜索 `compileTeachingBundle`、`attachCompiledTeachingBundle`，未找到实际调用方。Admin 页面/API 客户端也未接入 `teaching-bundle` 编辑。`templates-binding.service.ts:249–270` 对缺少 digest/payload 的绑定返回 `BUNDLE_COMPILATION_UNAVAILABLE`。

因此，草稿保存不等于可校验激活。失败路径为：保存需要 bundle 的草稿后直接 validate，会被拒绝。该结论由源码推导，本轮没有提交真实服务请求。

### A3：冻结 digest 不等于冻结能力全部执行

- `tutor.service.ts:514–543` 读取冻结团队版本。
- `tutor.service.ts:877–911` 依项目阶段和团队 pblSpec 选导师；`:1808` 读取当前 assistant runtime。
- `team-runtime.service.ts:555–580` 有 `resolveSessionAgent` 校验；非测试源码仅有定义，无调用。
- `templates-binding.service.ts:639–678` 的旧 `resolveDeepTeamBinding` 仍有角色正则、默认助手和硬编码 KB。未发现生产调用，不能把它说成当前授权入口，也不能直接启用来补齐授权。

需统一冻结 session/task、roleMap、skill pins、模型策略与权限的解析；新增授权不能扩张旧项目，当前撤权立即收紧。

### A4：IMA 项目授权未贯通

`tutor.service.ts:1799–1801` 的授权回调只有助手/工具 ID；`ima-mcp.client.ts:29–41,165–182` 直接转发工具参数。该链没有 frozen project grant 或项目 document provenance。

全局/助手授权不能代替历史项目授权。四个只读工具都需控制：列库过滤、搜索/列文档 KB 参数交集、读文档项目来源与过期重检索。任务 OPTICS-011。

### A5：当前练习不是知识库动态生成与团队解析

`tutor-quiz.service.ts:17–23,705–739` 使用 `findQuizBankEntry/gradeQuizKeys`；量化题满足条件后返回题库解析，定性题不通过此接口直接披露答案。`gateway-tutor.provider.ts:239–248` 还含禁止完整答案的全局提示。

需把“练习提交后完整解析”纳入 Admin 教学策略，接通题目来源、稳定实例、团队评阅候选与 owner 判分。不能仅在前端放出答案或只改提示词。任务 OPTICS-012。

### A6：动作被接受，界面就显示“已记录”

`tutor.service.ts:718–802` 写动作审计，返回 `accepted/actionId` 和可选仿真结果；`OpticsDiffractionScatteringCard.tsx:97–111,166–173,1147` 只检查 accepted 就显示已记录。

缺少可回读的观察记录 ID、run/参数/revision、证据类型及 CER/rubric 引用。审计动作不等于 observations owner 已保存学习证据。无 receipt 应显示待保存，不得转为掌握、作品通过或成长事实。

### A7：完整历史与统一课时视图仍缺

- `TutorPage.tsx:273–302` 已挂载团队栏、阶段树、当前课时卡。
- `tutor.service.ts:573–587,840–874` 的阶段取团队 workflow，课时按目标掌握推导，checkpoint 固定为空。
- `team-runtime.service.ts:1426–1474` 只读最新 run，每成员最近 20 条。
- `services/workers/src/team-runtime-executor.ts:107,188–207` 只返回结构化候选，不执行工具。

需要模板版本/计划 revision/sessionId 一致的完整课表，以及项目/run 历史分页；不能把已有字段当成真实工具调用已发生。

### A8：本轮复现 API 编译阻塞

隔离构建最新依赖后，`templates-binding.controller.ts:232,246` 对只读 `TeachingBundleDraft['modelByPurpose']` 赋值，报 `TS2542`，API 行为测试阶段未执行。

用可变局部 builder 或 `Object.fromEntries` 构造，再输出只读合同；不要用 `as any` 削弱公共类型。此轮为审计，未修该源码。

## 完成交付条件

管家选择真实模板并完成多资源修改/发布回读；两个确认入口冻结同一合同；确认前仍探索，确认后按冻结课时执行；对话内交互/观察/KB 出题/团队解析闭环；右栏课表一致且历史可查；最后通过真实隔离数据库、模型与浏览器验收。当前未满足。
