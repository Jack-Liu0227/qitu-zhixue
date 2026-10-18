# 自适应 PBL 实施计划

> 状态：`planned / 待 Issue 拆解与评审`；不表示代码已完成。
> 依据：[调研报告](./research-report.md) · [架构方案](./architecture.md)
> 关系：补充而非替代 `docs/plan/p0-*`、`p1-*` 既有任务；先创建/关联 Issue 后再实现。

## 1. 目标闭环

```text
模板发布 + 团队版本
  -> 激活唯一模板-团队绑定
  -> 学生对项目意图明确确认
  -> 服务端原子创建项目并冻结绑定快照
  -> 服务端生成并校验个性化课程计划/大纲
  -> Tutor Leader + 阶段子 Agent 提供受限协同
  -> 学生回答/选择/提交证据
  -> learning-plan/mastery/works owner 记录正式学习证据
  -> 微循环调整提问与提示；必要时提交带 revision 的宏观补救建议
  -> 现有门禁控制实践、评审和完成
```

## 2. 分阶段任务

### P0 — 基线核查、绑定合同与决策门

**范围**：`packages/contracts`、`packages/database`、`services/api`、管理端配置读取。

- 与现有 `pbl-template-team-binding-architecture.md` 和运行时代码逐项做差异清单，明确当前模板/团队的真实绑定方式、存量配置能否唯一匹配、团队可否复用。
- 确认团队版本化和绑定唯一性规则；记录兼容窗口、绑定激活/退休状态、hash 规范和错误码。
- 完成 contracts 的 team version/binding/项目快照 DTO、Schema 校验器、权限矩阵与错误码草案；保持既有四阶段和核心门禁不变。
- 建立验证基线：模板配置 fixtures、意图确认重复请求、team-runtime gate tests、权限拒绝、当前 Tutor 互动组件状态。

**验收**：架构评审通过；无团队名称/title 字符串匹配作为最终绑定事实；未决的“一团队多模板”语义有书面结论；无任何业务行为变更。

### P1 — 不可变团队版本与模板绑定

**范围**：数据库迁移、admin config service/API、已有 `/admin/settings/templates` 与 `/admin/settings/teams`。

- 按版本创建不可变 `admin_team_versions` 和 `pbl_template_team_bindings`；数据库部分唯一索引防止并发重复激活。
- Admin API 校验成员、Leader、阶段归属、工具/routes、TheoryMastered 强制门禁；写操作携带 `Idempotency-Key`、对象权限和审计。
- 管理 UI 在现有设置 IA 中支持绑定验证、激活、退休、影响项目预览；覆盖 loading/empty/error/offline/permission-denied。
- 为存量配置创建 draft 绑定；执行只读 shadow compare，解析冲突时拒绝推荐，不自动猜测或切换。

**验收**：同模板不可并发激活两条绑定；team/template 更新不修改历史版本；未发布/禁用成员无法激活；管理员撤权和 DB 不可用时 fail closed；迁移可回滚且不删除项目快照。

### P2 — 立项事务接线与计划/大纲持久化

**范围**：`projects`、`learning-plan`、`plan-outline.ts`/store、模板与计划读投影。

- 在现有学生显式确认意图的 owner 命令中解析 active binding；同一命令幂等创建项目、学习计划关系及冻结模板/团队/binding references。
- 接线 `PlanOutlineStore` 的 PostgreSQL 实现/迁移；确认计划和大纲在正确事务或可靠命令链路内落库，课次教学计划按需惰性展开。
- 个性化输入严格限定在目标表达、4/8 周/排期等用户可选择字段；模板目标与阶段保持不变。
- 默认使用现有确定性生成；如启用 LLM 计划候选，置于 feature flag 下，经过纯函数 validator 校验 schema、目标 ID、DAG、时长、阶段/门禁和必需证据。
- 服务端返回项目大纲摘要和当前下一课次；学生端在当前项目/Tutor 工作区消费，不新增冻结导航一级入口。

**验收**：未确认时无正式项目行；确认事务失败不留下半绑定项目；同键重放同一项目/计划/大纲；确认后的大纲/模板版本不可覆盖；未过 `TheoryMastered` 的计划不能解锁实践工具。

### P3 — 回答驱动的微循环与类型化选项

**范围**：`packages/contracts/src/tutor.ts`、`ai-tutor`、`learning-plan`/`mastery`、Tutor 组件与流。

- 补稳定 `optionId/actionId` 作为 `optionLabel` 的兼容增量；服务端将选项与 turn/session/project/version 绑定并校验，拒绝过期/跨项目/伪造动作。
- 把既有 quiz 块与 `pending_questions`/答案 owner 统一；明确每类题目的唯一判分入口，不重复计入 mastery。
- 建立版本化的 `TutorActionPolicy`（纯函数优先）：待答问题、当前 objective、错误类型、正确/错误 attempt、显式 hint/explain、既有 stall policy 和门禁投影决定有限下一动作。
- 先用模板题库/已审核题目；LLM 变体只生成候选，验证答案字段隔离、选项结构、objective 引用、题干长度、单解检查和答案泄露过滤后才能给学生。
- 光学模板先落地 `Observe -> Predict -> Manipulate -> Measure -> Explain -> Challenge -> Submit` 微循环；为 `optics_experiment` 增加 `specVersion`、`objectiveId`、受控参数和稳定 `actionId`，实验回调改为幂等事件，不把摘要文本当作正式证据。
- 为 `optics.wave.diffraction`、`optics.wave.scattering` 增加开放观察/CER 题、错误类型和补救提示；衍射使用单缝 `lambda/a/D` 受控变量，散射使用封闭细雾室的可见性比较，均不绕过 `TheoryMastered`。
- SSE 通过既有回复/团队帧展示题目与 Agent 身份；UI 处理 loading、提交中、重复/重放、错误、离线保留草稿和权限失败。

**验收**：两次相同 quiz/action 提交只落一份 attempt/event；未答题优先级最高；错答不会在 gate/mastery 未达标时泄漏答案；文本/选项/测验都不让客户端写 pedagogic move、hint level 或 mastery；`TheoryMastered` 之前不出现实践模拟/工具。

### P4 — 有审计的宏观补救与教师介入

**范围**：`learning-plan` revision/change store、`ai-tutor` 卡顿信号、Teacher 投影、outbox。

- 基于当前已有的结构化 attempt/stall/作品评审信号定义触发规则版本；采用保守阈值并在试点调参，不使用未经验证的隐性行为分析。
- 新增 append-only `ProjectPlanAdjustment`/执行计划 revision：`baseRevision`、evidenceRefs、reason code、动作、策略版本、幂等键和状态。
- MVP 允许同一目标下新增可选补救练习/例子或建议人工协助；禁止移除必做目标/产物、修改模板快照、变更 prerequisites、快进阶段或放行实践门禁。
- 对涉及目标/必需证据/时间承诺的更改提交候选，需学生明确确认和/或教师批准；Projects/Learning Plan owner 接受前不写为正式状态。
- Teacher 只收到最小化卡点 reason + evidence refs/安全摘要；不在列表或通知中包含原始对话/音频。

**验收**：过期 revision 提交返回冲突；相同触发只产生一个调整；调整完整审计且不含原始对话；任何变更不能绕过门禁；教师无该学生 assignment 时无法查看。

### P5 — 单模板试点、验证和渐进发布

**范围**：一个 4 周/每周约 2 小时、适龄安全审查通过的 PBL 模板；学生、教师和运维共同验收。

- 先使用固定模板与确定性计划，不同时试点任意模拟、任意 HTML、开放 MCP 或自动阶段推进。
- 端到端回放：立项、绑定、首个 quiz/选项、答错提示升级、答对掌握、实践门禁、证据提交、人工介入、重复请求和断网恢复。
- 增加一条光学回放：同一项目先验证理论门禁，再运行衍射和散射模拟，记录参数/观察/CER，检查错误分支、提示淡出、作品引用和教师最小化卡点摘要。
- 衡量可行性与教学体验：完成率、各课次继续率、必需证据质量（rubric）、概念前/后测、提示层级/独立作答比例、卡点/教师介入、题目歧义或泄漏、运行错误和权限拒绝；给定样本不足时只报告描述统计。
- 分别进行教师设计评审、移动/桌面 UI 评审、安全/隐私检查、数据保留/删除检查。通过后逐步提高 feature flag 比例；否则关闭新绑定解析/宏观调整开关，保留只读记录和已冻结项目语义。

**上线门槛**：项目权限越权/门禁旁路/跨学生数据泄露为零；答案泄露、不可恢复重复计分为零；所需错误状态和回滚已验证；教师确认至少一个完整学生周期可执行。学习成效结论须等预注册或明确对照设计及足够样本，不从无对照的试点宣称因果。

## 3. 横向必测项

- Contracts/API：未知字段、客户端 server-owned 字段、idempotency conflict、Problem Details 错误码、对象级权限。
- DB/并发：绑定双激活竞争、同学生并发 run、项目确认并发、答题并发、过期计划 revision、outbox 重放。
- Team Runtime：team version/binding hash 不匹配拒绝；route allow-list；子 Agent 输出格式错误、超时、租约过期、部分失败和模型不可用。
- Mastery/gates：重复答题不重复计分；理论掌握只能由 owner 判定；实践工具服务端重校验 `TheoryMastered`；未确认意图不立项。
- UI：loading/empty/error/offline/permission-denied；移动窄屏；键盘/可访问性；过期的选项/题目和重试体验。
- 隐私：返回体/日志/audit/team frame 不含提示词、答案密钥、无关学生数据和原始语音；家长/教师投影按授权范围。

## 4. 验证命令

分阶段运行受影响的 workspace 测试和 typecheck，合并前执行：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check:basepath
```

上线前还需执行仓库已有项目/Team Runtime 验证脚本及目标环境真实 worker/DB 冒烟测试；demo/mock 结果不能作为真实协同验收。

## 5. 产品/Issue 决策点

1. 是否允许团队版本同时服务多份模板；若允许，绑定唯一索引只约束模板版本，并重新检查 route/上下文差异。
2. 学生是否在立项前预览完整 4/8 周大纲，还是确认后在 Tutor 中查看；无论哪种，正式项目仍只能在明确确认动作后创建。
3. 哪些项目模板允许模型生成候选题目，哪些必须只用教研审核题库；开放探究题不默认转成单选题。
4. 哪类计划变更可由服务端自动加入可选补救，哪些需要学生确认或教师批准。
5. 数据留存期和教师/家长的计划调整可见范围需由产品与隐私负责人评审，开发任务不可自行放宽。
