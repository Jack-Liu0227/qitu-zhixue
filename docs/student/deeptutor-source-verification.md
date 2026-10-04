# DeepTutor 源码核对记录（v1.6.11）

- 日期：2026-09-25
- 仓库：`/root/team-workspaces/DeepTutor`
- 来源 SHA：`a053fecf6eeca51ded680de8b8fc41ef63857b11`（`release: v1.6.11`，2026-09-24）
- 体量：326 MB；Python 1748 个文件 / 279,155 行；TS/TSX 1198 个文件

## 0. 这份仓库是怎么来的（重要）

用户给的原始路径是网络共享 `//192.168.137.2/科研资产/Study/qitu-zhixue/DeepTutor`。

**该共享在当前环境不可达**，探测证据：

| 探测 | 结果 |
|---|---|
| 本机网络 | `10.0.0.11/22`（NAT VM），网关 `10.0.0.1` |
| `ping 192.168.137.2` | 3 包 100% 丢失 |
| `192.168.137.2` 的 139 / 445 / 80 / 22 | 全部不可达 |
| `10.0.0.1` 的 445 / 139 / 3389 | 全部关闭 |
| 扫 `10.0.0.0/24` 全段 445 | 无任何主机开放 |
| 路由 | `192.168.137.0/24` 指向默认网关，但该网段（宿主机 ICS/热点）未被转发 |
| SMB 工具 | `smbclient` / `mount.cifs` / `rclone` 均未安装 |

GitHub 可达。用户随后自行把仓库放到 `/root/team-workspaces/DeepTutor`。
**该副本 SHA 与上游 `HEAD` 一致，无本地提交**（`git status` 报 1287 处改动，经 `git diff --numstat` 核对为
`additions=280263 / deletions=280263` —— 等量增删，是**换行符差异**，非内容改动）。

> ⚠️ 若你那份共享副本带有**本地修改**（自己的笔记、改过的提示词、config），当前这份不含。
> 需要的话请把差异补上来，否则本文所有结论只对上游 v1.6.11 成立。

## 1. 上一轮设计文档引用复核（逐条通过）

`docs/student/tutor-curriculum-design.md` 与 `student-agent-design.md` 里的 DeepTutor 引用，
在 v1.6.11 上**全部成立，连行号都对上**：

| 上一轮引用 | v1.6.11 实测 | 结论 |
|---|---|---|
| `learning/models.py:24` 四类目标 | `class KnowledgeType(str, Enum)` 正好在 `:24` | ✅ |
| `learning/models.py:36` 错误四分类 | `:17-20` 中文名映射、`:37 KNOWLEDGE_STRUCTURAL = "structural"` | ✅（行号 ±1） |
| `learning/mastery.py` 近期加权 | `:17 _RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0)` | ✅ |
| `learning/scheduler.py` 间隔序列 | `:17 MEMORY: [0,1,3,7,14,30,60]`、`:20 DESIGN: [14,28]` | ✅ |
| `learning/grading.py` 判分阈值 | `:38 len(expected) <= 30`、`:39 SequenceMatcher(...).ratio() >= 0.85` | ✅ |
| 15 个被引用文件全部存在 | 15/15 存在 | ✅ |

### 1.1 「DeepTutor 没有分级提示阶梯」—— 复核后结论不变

- 全仓库搜 `hint_level` / `hint ladder` / `graduated` / `scaffold_level`：**没有教学意义的提示阶梯**。
- `learning/service.py:450`、`:1548` 的 `status = "graduated"` 是**复习状态毕业**（间隔复习跑完），与提示等级无关。
- `api/routers/settings.py:473` 的 "retry ladder" 是**网络重试**；`routers/knowledge.py:4494` 的 "route ladders" 是**路由**。
- `hints_used` 只出现在 `services/session/sqlite_store.py`（`:379`、`:788`、`:898`、`:921`、`:932`、`:2944`），
  是**SQLite 里的一个 INTEGER 计数列**，作为判分质量惩罚的输入，不是阶梯。

→ **1–5 档提示阶梯仍是本产品自有资产，不能说成参考 DeepTutor 得来。**

### 1.2 「只提问不给答案」的 hint —— 逐字验证通过

`services/mastery_hints.py:282 _sanitize()` 的 docstring 原文：

> The question mark is a real check, not tidying: it is the cheapest reliable
> signal that the model wrote a question rather than the answer it was told not to write.

行为：去围栏/引号/项目符号 → 多行只取最后一句 → **不以 `?` 或 `？` 结尾则返回空串** →
超过 `_MAX_HINT_CHARS[lang]` 也返回空串。
`AskHint`（`:67`）字段只有 `hint` / `knowledge_point_id` / `generated_at` —— **单个提问，不是阶梯**。
该机制可直接借用（见第 3 节）。

## 2. 上一轮侦察的遗漏（对本项目影响很大）

`learning/` 下有一批文件上一轮完全没记录：

| 文件 | 行数 | 为什么重要 |
|---|---|---|
| **`objective_relations.py`** | 181 | **`validate_objective_relations()`（`:72`）已实现自引用检查 + 未知前置检查 + 环检测**（`:118 ObjectiveRelationError("Prerequisite cycle: ...")`）。这正是 `tutor-curriculum-design.md` 要求的「前置无环」不变量——**不用自己写，可移植** |
| **`topic_generation.py`** | 594 | `ground_topic_sources`（`:241`）→ `materialize_modules`（`:308`）→ `_module_objective`（`:284`）。**「兴趣/资料 → 模块」的物化链路**，正对「兴趣 → 4/8 周模块」 |
| **`topic_materials.py`** | 583 | 主题素材装配 |
| `topic_naming.py` | 166 | 主题命名 |
| `navigation.py` | 348 | `topic_cards`（`:87`）、`resolve_module`（`:217`）、`navigable_session_rows`（`:308`）—— 模块/会话导航 |
| `prompts.py` | 156 | 提示词装配（上一轮只记了 `agents/loop/prompt_blocks.py`） |
| `event_hub.py` | 140 | 事件总线 |
| `identity.py` | 67 | 标识生成 |
| `migration.py` | 324 | 迁移 |

**另一处遗漏：学习提示词有中文版。** `learning/prompts/` 下同时有 `en.yaml`（6071 B）与
**`zh.yaml`（5298 B）**，键为 `diagnostic / explain / feynman / practice / error_diagnosis / review / notebook / topic`。
上一轮只记了 `en.yaml`。对一个中国 K-12 产品，`zh.yaml` 是直接可读的语料基线。

## 3. 由此对设计文档的修正建议

1. **`tutor-curriculum-design.md` 第 7 节「移植注意」增加一条**：计划 schema 校验里的「前置无环」
   直接对齐 `learning/objective_relations.py:validate_objective_relations` 的三种错误
   （自引用 / 未知前置 / 环），错误信息形态也照抄，便于后续比对。
2. **`curriculum-planner` 切片应补看** `topic_generation.py` 与 `topic_materials.py`：
   我们的「兴趣 → 4/8 周模块」比 DeepTutor 的「资料 → 模块」输入更窄、约束更多，
   但**模块物化与 ID 生成的写法可参考**（`_new_entity_id`，`:298`）。
3. **`question-bank` 切片的「只提问不给答案」可直接借** `services/mastery_hints.py:_sanitize`
   的判定方式（问号结尾 + 长度上限 + 空串失败），但必须补语言与年龄适配。
4. **中文提示词不必从零写**：`learning/prompts/zh.yaml` 是可用起点，但它是成人自学语域，
   面向儿童需要重写语气与词汇，且必须过「不给答案」检查。

## 4. runtime 编排核心（已侦察完成）

来源：子代理 `dt-research-1`（`deepseek/deepseek-v4-pro` / high），只读侦察。

### 4.1 一次 turn 的真实调用链

```
WS unified_websocket            api/routers/unified_ws.py:44
  -> turns.start_turn()         同文件 :222  -> subscribe_turn() :237
  -> TurnApplicationService.start_turn   app/service.py:35  -> runtime.start_turn() :52
  -> TurnLifecycle.start_turn    services/session/turns/request_preparer.py:131
  -> TurnExecutor._run_turn      services/session/turns/executor.py:141
       建 UnifiedContext(active_capability=payload["capability"])   :887
  -> TurnEngine.execute          runtime/turn_engine.py:14   -> ChatOrchestrator().handle() :27
  -> ChatOrchestrator.handle     runtime/orchestrator.py:61
       cap_name = active_capability or "chat"  :96
       StreamBus()  :128  -> await capability.run(context, bus)  :141  -> yield bus.subscribe() :187
  -> ChatCapability.run          agents/chat/capability.py:30
  -> AgenticChatPipeline.run     agents/loop/pipeline.py:394
       _compose_enabled_tools()  :406  -> AgentLoop(...).run()  :418-426
  -> AgentLoop._run_loop -> _dispatch_tool_calls  agents/loop/pipeline.py:1105
  -> dispatch_tool_calls         runtime/agentic/tool_dispatch.py（并行执行工具）
  <- 回程：_publish_live_event  services/session/turns/lifecycle.py:610（分配 seq、落库、发布）
```

> 真正的 turn 入口是 **`TurnApplicationService.start_turn`**（`app/service.py:35`）；
> runtime 内的分发点是 **`ChatOrchestrator.handle`**（`orchestrator.py:61`）。

### 4.2 关键对象职责（纠正「ChatOrchestrator 是总调度器」）

| 对象 | 实际职责 |
|---|---|
| `runtime/orchestrator.py` `ChatOrchestrator` | **薄分发器**：选能力 → 建 `StreamBus` → `capability.run()` → 发布 DONE/usage。**不是大脑** |
| `runtime/turn_engine.py` `TurnEngine` | 包一层懒加载工厂，是稳定补丁点 |
| `runtime/agentic/**` | **通用 label 驱动 LLM 循环**（`loop.py:176`）+ 并行工具分发；与具体能力解耦 |
| `runtime/capability_routing.py` | 只有**一条**执行前改道规则：`chat → deep_question`（`:49`），2 条正则（中/英），置信度 0.96 |
| `runtime/capability_catalog.py` | 纯工厂注册表，键为 `(kind, name)`（`:43`） |
| `runtime/mode.py` | 仅 CLI vs SERVER 环境标志，**无路由职责** |
| `runtime/registry/**` | `CapabilityRegistry`（懒加载类 + entry-point 发现，`capability_registry.py:88-119`）与 `ToolRegistry`（生成 OpenAI 工具 schema） |
| `runtime/stream_bus.py` | 单 turn 内的异步扇出 + 便捷发射器（`:37`） |

`partners/__init__.py:7` 那句注释的含义已澄清：**成立但有细微差别** ——
`ChatOrchestrator` 是个**活的类**（不是字符串别名），但很薄；chat 的"大脑"是 `AgenticChatPipeline`，
不是 orchestrator。那句注释的断言是**准确的**。

### 4.3 「不是 Multi-Agent Debate」—— 硬证据成立

用户的外部描述「不是传统 Multi-Agent Debate，而是 Agent-native Orchestrator + Capability Pipeline + Tool-use Loop」
**方向正确**，有直接引语佐证：

- `agents/loop/agent_loop.py:252`：`AgentLoop` docstring —— "Run one chat turn as a single agent loop over one conversation"
- `runtime/agentic/loop.py:1-5,176`：`run_agentic_loop` —— "drives a conversation with the LLM until a terminal label fires"

多阶段能力（`research`、`deep_question`）是**多个顺序的单模型循环**，不是平级 agent 互传。
`consult_subagent` 是**一个工具调用**，不是平级编排。

### 4.4 Capability 契约（可移植的最小接口）

- 最小实现：继承 `TurnCapability`，提供 `manifest: CapabilityManifest` 与
  `async def run(self, context, stream)` —— `core/capability_protocol.py:37-62`
- 发现：内置走 `BUILTIN_CAPABILITY_SPECS`，外挂走 entry-point 组
  `deeptutor.extensions` / 旧 `deeptutor.plugins` —— `capability_registry.py:88-119`
- 选择：**确定性，不由模型决定** —— 来自请求的 `context.active_capability`
  （`executor.py:887`），默认 `"chat"`（`orchestrator.py:96`），外加**唯一一条**改道规则
  `route_explicit_quiz_request`（`capability_routing.py:49`），由 `capability_routing_enabled` 开关控制
  （`request_preparer.py:162-166`），只有 `chat→deep_question`、2 条正则、置信 0.96

### 4.5 工具准入（对「禁止给完整答案」护栏直接有用）

**每 turn、按能力、确定性**，**不由模型决定**。`compose_enabled_tools`
（`agents/_shared/tool_composition.py:170`）按四层合成：

1. 用户勾选的 `context.enabled_tools`，按 `optional_whitelist` + 注册表过滤
2. 条件自动挂载，由 `_CONDITIONAL_MOUNT_FLAGS` 定义（`:54`）
3. 能力自有的 `owned_tools`（`capabilities/protocol.py:128`）
4. **常开地板**：`write_memory / web_fetch / github / ask_user / cron`（`:327`），workspace 基线始终追加

调用点：`agents/loop/pipeline.py:725`；且仅在模型支持原生工具调用时才生成 schema（`:406-410`）。
模型只能**在已准入的工具里选择调用哪个**。

> 对我们的含义："不给完整答案"这类护栏应当做在**准入层**（哪些工具/提示可用），
> 而不是指望模型自律。这与我们自己的 hint ladder 思路一致。

### 4.6 流式与事件

- `StreamBus`（`stream_bus.py:37-143`）：进程内异步扇出，保历史、可选 seq
- 事件信封 `StreamEvent`：`type / source / stage / content / metadata / session_id / turn_id / seq / timestamp`
  （`core/stream.py:29-64`）
- 传输：**WebSocket JSON**（`unified_ws.py:58-65`）—— **本仓库范围内没有发现 SSE**
- 断线重连**安全**：单调 seq + 持久化 journal，`subscribe_turn(after_seq)` 回放
  （`app/service.py:143-205`；`unified_ws.py:252`）
- 另有进程级 `EventBus` 发布 `CAPABILITY_COMPLETE`（`events/event_bus.py:22-101`）

> 对我们的含义：我们 `packages/realtime` 与产品文档 9.3 的流式接口要对齐 **WS + seq 回放**，
> 而不是只做 SSE。这是一个需要在设计文档里明确的点。

### 4.7 runtime 层复用判断

| 机制 | 判定 | 理由 |
|---|---|---|
| turn 调用链（持久化 + 回放） | ADAPT | 通用，但能力/工具注册表是 DeepTutor 特有形态 |
| StreamBus / registry / catalog / orchestrator 分发 | DIRECT-REUSE | 通用基础设施概念 |
| 单大脑 label 驱动循环 + 并行工具分发 | DIRECT-REUSE | 与具体产品无关 |
| Capability 契约（`manifest` + `run(context, stream)`） | DIRECT-REUSE | 干净的最小接口 |
| 工具准入合成函数 | ADAPT | 合成逻辑可借，但 toggle/自动挂载语义是 DeepTutor 产品策略 |
| 流式 seq 回放 + 事件信封 | DIRECT-REUSE | 通用传输基础设施 |
| `partners/__init__.py:7` 那句注释 | SKIP | 只解释本仓库 |

## 5. 已确定的外部描述纠偏（本文作者亲自核验 + dt-research-1 佐证）

| 外部说法 | 源码事实 |
|---|---|
| 「核心入口是 `ChatOrchestrator`（总调度器）」 | ⚠️ **部分成立**：类真实存在（`runtime/orchestrator.py:61`，`runtime/__init__.py:13,23-24` 有导出），但它是**薄分发器**不是大脑。真入口是 `TurnApplicationService.start_turn`（`app/service.py:35`），chat 的大脑是 `AgenticChatPipeline`/`AgentLoop` |
| 「Capability Layer: Chat / Deep Research / Deep Solve / Mastery Path / Visualize」 | ❌ 实际 `capabilities/` 下 18 个目录：`ask_questions, audio_overview, course_study, explore_context, ima, marginnote4, mastery, obsidian, partner_authoring, partner_group, reading, setup, solve, subagent, watching`（+ `prompts, protocol.py, registry.py` 非能力）。**没有 Chat 能力**（chat 在 `agents/chat/`），**没有 Deep Research 能力**（research 在 `agents/research/`），**Visualize 也在 `agents/visualize/`** —— 该清单把 `agents/` 和 `capabilities/` 混在了一起 |
| 「集成 LangGraph」 | ❌ `langgraph` 在 `pyproject.toml` / `requirements/` / `requirements.txt` 中**零命中**，DeepTutor 未使用 LangGraph |

## 6. capabilities 与 agents（已侦察完成）

来源：子代理 `dt-research-2`（`deepseek/deepseek-v4-pro` / high），只读侦察。

### 6.1 核心结构事实：存在**两套**注册表（推翻单一「能力层」框架）

| 注册表 | 位置 | 是什么 | 数量 |
|---|---|---|---|
| **Turn capabilities** | `runtime/bootstrap/builtin_capabilities.py:35` `BUILTIN_CAPABILITY_CLASSES` | 用户可选的 turn 模式 | 12，其中 **6 个实现在 `agents/**` 内** |
| **Loop capabilities** | `capabilities/registry.py:48` | `LoopExtension`——**上下文门控插件**，给共享 chat loop 增加/替换工具面与提示词 | 见 `capabilities/` 目录 |

- `builtin_capabilities.py:36` chat → `deeptutor.agents.chat.capability:ChatCapability`；`:40` deep_research；`:41` deep_question；`:42` visualize；`:120` math_animator。
- 各个 `agents/*/capability.py` 自己构造 pipeline（例：`agents/research/capability.py:69` `pipeline = ResearchPipeline(...)`）。
- `solve / reading / watching / course_study / ask_questions / mastery / audio_overview` 也有一个 `TurnCapability`，但它只是启动 `AgenticChatPipeline`。
- `obsidian / marginnote4 / ima / subagent / setup / partner_authoring / partner_group / explore_context` **只以 loop extension 存在**，自身不是 turn capability。
- 因此：**`agents/**` = 引擎 + 它的能力外壳；`capabilities/**` = chat loop 的扩展。**两者汇入同一个 turn engine。

### 6.2 Capability 清单与复用判断

| Capability | 职责 | LLM/确定性 | 消耗工具 | 行数 | 可移植 |
|---|---|---|---|---|---|
| ask_questions | 通过 `ask_user` 强制进行的访谈 turn（`capability.py:12`） | LLM | ask_user | ~90 | ✅ 可（chat loop） |
| audio_overview | 知识库 → 双人声音频 + 文字稿（`:20`） | LLM 分段 | rag | ~660 | ❌ 需 TTS/workspace/KB |
| course_study | 课程状态感知 + 交接（`mode.py:1`） | LLM + 确定性预摘要 | course_*, rag/web/exec/reason | ~1350 | ❌ 需 courses_state |
| explore_context | 确定性/LLM 预处理：读附件源（`:1`） | LLM 预处理 | read_source | ~780 | ❌ 需 source_index |
| ima | 腾讯 IMA 库检索，增量式 | LLM | ima tools | ~700 | ❌ 第三方 |
| marginnote4 | MN4 库，独占 `KnowledgeCapability` | LLM | 7 个 MN4 工具 + ask_user | ~1220 | ❌ 第三方 |
| **mastery** | 导师循环 + 按类型硬门槛 | LLM 循环 + 确定性门槛 | mastery_*, rag/read_source/ask_user | ~4000 | ⚠️ ADAPT（门槛模式对，存储是 topic 树不是项目） |
| obsidian | vault 检索/写作，独占 | LLM | 9 个 obsidian 工具 | ~890 | ⚠️ 半（文件系统 vault） |
| partner_authoring | `propose_partner` 草稿 | LLM | propose_partner | ~195 | ❌ |
| partner_group | 搭档互调协议 | LLM | invoke_other | ~390 | ❌ |
| reading | 沉浸阅读 + 确定性定位预处理 | LLM + 确定性 | 5 个阅读工具 + web/exec/reason | ~1350 | ❌ 需 reading store |
| setup | DeepTutor 自配置 | LLM + 确定性 apply | 4 个 setup 工具 | ~1350 | ❌ |
| **solve** | plan → 逐步门槛 → 重规划的脊柱（`SolveSession`） | LLM + 确定性 | solve_*, rag/exec/geogebra/reason | ~570 | ⚠️ ADAPT（对应阶段门控，但是单 turn 内存态） |
| subagent | 咨询本地/搭档 agent，独占 | LLM | consult_subagent | ~630 | ❌ 需 subagent 后端 |
| watching | 时间戳锚定的视频导学 | LLM + 确定性文字稿 | 无自有 | ~170 | ❌ 需 video store |

### 6.3 Agent 清单（`agents/**`）

| 包 | 职责 | 行数 | 与 capability 的关系 | 判定 |
|---|---|---|---|---|
| `_shared` | capability_result、tool_composition、tool_runtime、workspace_prompt、json | ~700 | 为各 pipeline 提供共用管道 | **DIRECT-REUSE** |
| `loop` | **通用 agentic 工具循环引擎** + pipeline 宿主 + 提示词装配 | ~4870 | 通用引擎；chat 与 mastery 均继承它 | **DIRECT-REUSE** |
| `chat` | `AgenticChatPipeline` + `ChatCapability` | ~80 | **它就是** chat capability | **DIRECT-REUSE** |
| `research` | `DeepResearchCapability` + `ResearchPipeline` | ~5550 | 能力外壳跑 pipeline | **ADAPT**（分解 + 分块循环可用于生成计划） |
| `question` | `DeepQuestionCapability` + `QuestionPipeline` + `FollowupAgent` | ~3300 | 同上 | **ADAPT**（练习/测验节） |
| `visualize` | `VisualizeCapability` + 遗留 `VisualizePipeline` | ~1080 | 能力外壳；遗留 pipeline 仅供 `book/blocks/*` | **ADAPT**（成品渲染/预览） |
| `math_animator` | `MathAnimatorCapability` + pipeline + 5 个阶段 agent | ~2100 | 能力外壳跑 pipeline | **SKIP**（细分渲染器） |
| `vision_solver` | 图像→GeoGebra 单次 | ~206 | 被 `geogebra_analysis` 工具消耗（`tools/builtin/__init__.py:645`） | **SKIP** |
| `notebook` | 分析/汇总 notebook 记录 | ~520 | 被 API 路由与 book 消耗，**不是 capability** | **ADAPT**（子记录汇总 → 作品证据） |
| `base_agent.py` | 遗留 `BaseAgent`（LLM 配置/调用） | ~793 | 仅 vision_solver + FollowupAgent 用 | SKIP |

### 6.4 `agents/loop/**` = 通用引擎（不是某个功能）

- `agent_loop.py`（~1809）：循环本体。**一 turn = 一段持续增长的对话；每轮 = 一次 LLM 调用；没有工具调用的那轮结束 turn**（`:1-14`）。
- `pipeline.py`（~1911）：**宿主** —— 工具、轮次/token 预算、分发、能力钩子，不含 chat 特有逻辑（`:1-16`）。
- **提示词装配（Named Prompt Blocks，可复用）**：`prompt_blocks.py` 的 `LoopPromptAssembler.blocks()` 生成有序的命名 `PromptBlock` 列表 —— 先 `foundation_blocks()`（identity / runtime_context / runtime_policy / loop protocol），再能力块、记忆、工具清单、skills、sources、notebooks、workspace（`:118-186`）；`render()` 用 `## {name}` 分段、`---` 分隔（`:80`）。
  循环通过 `prompt_module` / `prompt_agent` / `prompt_assembler_class` 定制（`pipeline.py:207-220`）；
  **自带协议的循环会整个替换 `foundation_blocks()`，而不是追加一段修正**（mastery 就是这么做的：`capabilities/mastery/pipeline.py:35-44`）。
  `split_for_replay()` 把常驻指令与 `RUNTIME_BLOCK_NAMES` 快照分开（`:27,98`）。
- **对我们的含义**：这套「命名提示块 + 整块替换」的做法，比我们目前「一段大提示词 + 追加约束」更可审计——
  建议 `tutor-pedagogy` 切片改成命名块组装，且「不给答案」协议作为**基础块**而非追加约束。

### 6.5 `capabilities/subagent/**` 机制

当所选知识库 `type == subagent`（或绑定了 partner/group id）时，`SubagentCapability` 激活（`binding.py:1`），
chat loop **独占**在单个 `consult_subagent` 工具上（`capability.py:18`）。
每次调用：模型只提供 `question`；服务端通过 `augment_kwargs` 注入 `_subagent` 规格
（后端类型、cwd、逐后端配置、预算、会话状态）（`capability.py:89-151`）。
工具内 `await backend.consult(...)` —— **父 chat loop 阻塞**在子 agent 的完整运行上，
同时把它的原生事件流到侧边栏，最后把最终答案返回给模型（`tools.py:167`）。
隔离：**独立 OS 进程**（本地 CLI，如 Claude Code / Codex）在自己的 cwd，或搭档后端；
预算限制每 turn 的咨询次数；session id 跨咨询与跨 turn 串联上下文（`tools.py:100-137`）。

### 6.6 我们产品的能力缺口（DeepTutor 完全没有）

这是本次最有价值的输出——**我们产品的差异化层几乎都要自建**：

1. **从兴趣生成 4/8 周计划**：无 curriculum/日历/周-课次排期。`research` 的分解与 `question` 的 plan 最接近，但都不产出时间分相的学习计划。
2. **先理论后实践作为项目阶段门控**：mastery 的门槛是**按目标**的，不是项目阶段前置；solve 的门是单 turn 的。
3. **长生命周期项目状态机 / 阶段转换**：solve 的 `SolveSession` 是**每 turn 内存态**（`solve/session.py:1`）；没有跨周的持久项目状态。
4. **作品/作品证据模型**：有 workspace 条目，但没有作品集或「完成的作品」追踪与证据模型。
5. **家长向投影**：无家长角色、进度报告或仪表盘投影能力。
6. **班主任升级**：无人工介入升级角色/工具。
7. **持久的儿童兴趣画像**：`ask_user` 是每 turn 的，没有任何东西持久化演进中的兴趣画像。
8. **课次节律（1 小时课时）/ 排期**：无课时或日程概念。

> 结论：DeepTutor 能借的是**引擎与教学机制**（loop、提示块、掌握度门槛、判分、复习调度），
> 而**产品形状**（计划排期、项目状态机、证据、家长/班主任三个面）必须自建。这是值得的，因为那正是我们的护城河。

## 7. 待补（侦察进行中）

| 子代理 | 范围 | 待答 |
|---|---|---|
| `dt-research-3` | `tools/**`、`services/memory/**`、`knowledge/**` | 全量工具清单；**「L1/L2/L3 三层记忆」真伪**；实际集成的检索引擎 |
| `dt-research-4` | `api/**`、`multi_user/**`、部署、自带前端 | 集成面与多租户能力；「独立服务旁挂 / 移植 TS / 换 FastAPI」三条路的成本 |

