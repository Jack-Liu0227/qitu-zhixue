# 高中物理“光的散射与衍射”PBL 领域方案

> 状态：`proposal / 领域教学与交互设计`
> 原源码复核基线 f88bb73；2026-10-19 同步真实 AI 生成需求与参考 HEAD 8e8f9b4 的计划。历史物理/测试发现不等于已重新验收当前工作区。
> 适用项目：启途智学 `optics-physical-inquiry`
> 关联文档：[调研报告](./research-report.md) · [架构方案](./architecture.md) · [实施计划](./implementation-plan.md)

本文把当前仓库里的光学模板、题库、Tutor 交互和项目门禁，落到一个可实现的高中物理项目：**“为什么窄缝会产生明暗条纹，为什么雾室中能从侧面看见光束？”**。目标不是做一个“聊天机器人讲光学”，而是把学生的观察、猜想、调参、测量、解释和答辩连接成可审计的 PBL 证据链。

## 1. 研究结论

### 1.1 适合迁移的交互模式

| 来源 | 可借鉴的机制 | 在启途中的落点 | 不应照搬的部分 |
| --- | --- | --- | --- |
| OpenMAIC | Planner 将大纲逐步展开为 milestone/microtask；Instructor 围绕当前任务对话；Evaluator 在提交后评价 | `ProjectTemplateSpec`/`PlanOutline` 生成固定骨架；Tutor Leader 运行当前 microtask；`works/feedback` 负责正式评价 | 任意 HTML/脚本、无限制工具调用、多 Agent 同时发言；这些会扩大未成年人安全和审计边界 |
| DeepTutor | 将普通提问、Quiz、Question Bank、Mastery Path 分开；服务端保存待答题、尝试次数和掌握状态 | 题库问题绑定 `objectiveId`/`conceptId`；`learning-plan`/`mastery` 继续是唯一判分和门禁 owner；Tutor 只投影下一步 | 把开放探究强行变成单选题，或另建一套个人掌握数据库 |
| 启途现有实现 | 项目模板版本、四阶段、`TheoryMastered`、SSE、`TutorReplyBlock`、提示阶梯、卡顿信号和计划调整已经存在 | 只补齐光学领域合同、实验事件和受限策略，不新增 PBL 微服务或平行导航 | 不能让客户端或 Agent 直接写阶段、掌握度、作品通过或成长档案 |

### 1.2 光学项目必须形成“双循环”

1. **微循环（每轮回答）**：学生回答/操作 → 服务端分类证据和错误类型 → Tutor 选择追问、提示、例子、检查题或数据分析 → 学生再次回答。
2. **宏循环（跨课次）**：同一目标重复错误或显式卡顿 → 生成带 `baseRevision` 和证据引用的补救候选 → 服务端接受后追加同目标可选任务，或建议教师介入；不删除必做目标，不快进阶段。

宏循环不应根据“回复很短”“打字很慢”“模型猜测情绪”等隐式信号自动改变未成年人的学习路径。首期只用可解释信号：答题结果、提示请求、显式卡顿、实验观察、作品提交及教师评审。

## 2. 当前源码与网站基线

### 2.1 已有的光学内容

当前源码已经把散射和衍射加入光学内容，但它们的成熟度不同：

- `packages/ai-client/src/quiz-bank/optics/content.ts` 有 4 个门禁理论目标（反射、折射、全反射、透镜），以及 4 个非门禁波动模块（干涉、衍射、散射、偏振）。
- 当前项目有 **12 个核心目标**：探索 2、理论掌握 4、引导实践 4、作品评审 2；另有干涉、衍射、散射、偏振 4 个非门禁质化波动模块和两条模拟提示。散射/衍射目前不是独立的核心 objective，也没有自己的 mastery 门禁；后续若要把它们变成正式项目目标，必须先更新模板版本、计划测试、题库、量规和门禁设计，不能只改标题。
- `OPTICS_WAVE_INQUIRY_STEPS` 已定义两个证据优先的模拟提示：固定光源与屏距改变缝宽，以及在封闭细雾室中比较侧向可见性；两者标记为 `TheoryMastered` 前只能模拟，不得把模拟结果当作实践门禁证据。
- `packages/ai-client/src/quiz-bank/optics/misconceptions.ts` 和 `optics-quiz-bank.test.ts` 为现有反射、折射、全反射、透镜题目提供错误类型和补救提示。散射/衍射还需要补充同等粒度的题目、错误类型和开放作答评分。

### 2.2 已有的动态实验原型及其边界

当前工作树已有 `optics_experiment` 结构化块和 `OpticsDiffractionScatteringCard` 原型：

- 服务端投影已有实践阶段与 TheoryMastered 检查，但光学身份仍用 templateVersionId 前缀，不能匹配治理生成的真实 tplv-* ID，也没有冻结实验 allow-list。它是意图上的门禁，不是已验收的实验授权链路。
- 前端 `apps/student-center/features/tutor/components/OpticsDiffractionScatteringCard.tsx` 提供衍射/散射模式切换。衍射模式调节波长 `λ`、缝宽 `a`、屏距 `D`，显示 `sinc²` 形状和中央亮纹宽度；散射模式调节粒子半径与波长，显示尺寸参数和定性 Rayleigh/Mie 判断。
- block 已有 specVersion/objectiveId/sessionIndex/allowedActions；但回调仍通过 onSelectOption 发送摘要，没有具体动作实例、观测事件和服务端落库。它是**尚待物理/权限验收的可视化原型**，不是正式实验证据。
- 这张卡的结果应标记为“模型/模拟预测”，不能直接写入 `TheoryMastered`、实验报告通过或成长档案；物理量范围、计算模型和安全文案必须由服务端合同固定，不能由模型生成任意脚本。

### 2.3 网站信息架构上的落点

学生端已有冻结导航：今天、灵感空间、AI 搭档、我的项目、作品展厅、成长轨迹、个人画像。页面源码显示 AI 搭档是三栏工作区（会话、对话、项目/团队状态），项目详情负责阶段与交付物，理论页负责检查题。建议：

- **不新建“散射/衍射”一级页面**；把实验卡、问题卡、当前目标和证据提交嵌入 AI 搭档/项目工作区。
- 项目详情页显示计划、大纲、阶段、交付物和只读实验摘要；Tutor 页负责连续对话和下一动作。
- 理论页保留复习和 `TheoryMastered` 检查，但不能成为第二套掌握度路径。
- 移动端将实验参数、图形、问题和提交按钮纵向排列；加载、离线、权限失败、过期题目和提交重试必须可见。

## 3. 项目叙事与学习目标

### 3.1 驱动问题

> **为什么同一束光通过不同宽度的窄缝会出现不同宽度的中央亮纹？为什么没有雾时侧面看不见光束，而封闭细雾室中却能看见光路？两种现象能否用同一套“光与物质/孔径相互作用”的证据解释？**

最终作品不是一张答案海报，而是一份可复核的探究档案：问题与假设、变量表、实验或模拟记录、图表、模型解释、误差/边界、反思和口头答辩。

### 3.2 领域目标 DAG

以下目标沿用现有模板目标 ID；新增内容只作为领域合同和教学活动，不另建掌握库。

```text
opt-intent-observe -> opt-intent-question
opt-intent-question -> opt-theory-reflection -> opt-theory-refraction
opt-theory-refraction -> opt-theory-tir -> opt-theory-lens
opt-theory-lens -> opt-practice-setup -> opt-practice-measure
opt-practice-measure -> opt-practice-fit
opt-practice-measure -> opt-practice-fit -> opt-practice-report
opt-practice-measure -> optional wave inquiry (diffraction/scattering)
opt-practice-report -> opt-review-defend -> opt-review-reflect
```

散射和衍射目标在实践阶段，但前置的物理概念可以用低风险模拟预演；实践解锁仍由现有 `TheoryMastered` owner 决定。

### 3.3 兼容排期：4 周 / 8 课次建议

| 课次 | 阶段 | 学生活动 | 主要证据 | Tutor 重点 |
| --- | --- | --- | --- | --- |
| 1 | exploration | 观察窄缝条纹、雾室侧向可见性，写下差异 | 初始观察与问题 | 不讲结论，追问“你看到了什么” |
| 2 | concept_mastery | 反射/法线与模型边界 | 概念检查 | 识别几何光学直觉过度外推 |
| 3 | concept_mastery | 折射、速度/介质和方向变化 | 解释题与图示 | 对比“介质边界”和“孔径边缘” |
| 4 | concept_mastery | 全反射与临界角 | 受控题目 | 保持理论门禁，不提前开放实践工具 |
| 5 | concept_mastery | 透镜成像与光路图 | 程序性任务 | 检查光路图和变量定义 |
| 6 | guided_practice | 校准光路、选择缝宽/屏距、建立变量表 | 装置图与控制变量 | 只允许安全范围和注册模拟器 |
| 7 | guided_practice | 扫描缝宽/波长；比较雾室开关；拟合与误差 | 数据表、图、散射解释 | 数据分析、异常值和边界条件 |
| 8 | deliverable_review | 提交报告、答辩、反思 | 作品、rubric、反思 | 先问证据，再给迁移问题 |

新方案以 8 周 / 16 课时为主，完整课表/角色见 [一体化架构](./theme-session-team-ima-design.md)。上表仅为 8 节兼容参考，不能以此验收新 16 节版本。

## 4. 光学专用互动协议

### 4.1 每轮教学动作顺序（不是第二套 PBL 状态机）

```text
Observe -> Predict -> Manipulate -> Measure -> Explain -> Challenge -> Submit
   ^                                                      |
   +------------ remediation / teacher support -----------+
```

- `Observe`：学生描述亮暗条纹、光束可见性或图表变化，禁止 Tutor 先给解释。
- `Predict`：选择或输入“缝宽/波长/屏距改变会怎样”，要求说明理由。
- `Manipulate`：在注册实验卡中改变一个变量，服务端校验范围和实验版本。
- `Measure`：记录中央亮纹宽度、第一暗纹位置、是否侧向可见、观察角度等。
- `Explain`：用“主张—证据—推理（CER）”解释，不以单选正确代替解释能力。
- `Challenge`：改变一个边界条件或要求比较散射与衍射，检查迁移。
- `Submit`：把结构化证据引用到项目作品；正式通过仍由作品/教师 owner 判定。

### 4.2 题型与服务端信号

| 题型 | 学生输出 | 可靠信号 | 示例 |
| --- | --- | --- | --- |
| 观察题 | 文本/标注 | `observation` | “中央亮纹比旁边亮纹宽。” |
| 预测题 | 单选 + 理由 | `prediction` | “缝宽减半，中央亮纹变宽。” |
| 控制变量题 | 选择变量 | `control_variable` | “固定 λ 和 D，只改 a。” |
| 数据题 | 数值/表格 | `measurement` | 记录 `a, λ, D, Δx` 和单位 |
| 图表题 | 选点/趋势 | `graph_reading` | 判断 `Δx ∝ λD/a` 的趋势 |
| 开放解释 | CER 文本/语音转写 | `claim_evidence_reasoning` | “雾粒子把部分光散向观察者。” |
| 迁移题 | 比较或反例 | `transfer` | 区分孔径衍射、介质折射和粒子散射 |
| 反思题 | 结构化反思 | `reflection` | 哪个控制变量最影响可信度？ |

所有正式答案和证据都带 `objectiveId`、`projectId`、`templateVersionId`、`sessionId` 和幂等键。自由文本先保存为受权限保护的原始回答，计划调整只引用 `evidenceRef`、错误类型和安全摘要。

### 4.3 典型分支

**分支 A：把缝宽变窄预测为亮纹变窄**

1. 服务端将答案映射到 `optics.diffraction.inverse_slit_width`，不立即揭示公式。
2. Tutor 给 Level 1 追问：“保持波长和屏距不变，只把缝宽从 100 μm 调到 50 μm；屏上中央亮纹的边界向外还是向内移动？”
3. 学生操作模拟器并提交观察；若仍错，给出“第一暗纹满足 `sinθ = λ/a`”的局部提示，再要求用自己的话解释分母变化。
4. 重复同类错误可触发同目标补救候选；次数阈值属于可审核的策略版本，并非已验证通用规律。任何门禁都不得降低，也不跳过实践证据。

**分支 B：把散射说成光“穿过空气所以被看见”**

1. 标记 `optics.scattering.visibility`，要求比较“无雾/封闭细雾室”，保持光源和观察角度不变。
2. Tutor 追问“观察者收到的光来自原传播方向还是粒子改变后的方向？”并要求填写控制变量。
3. 正确后要求迁移到蓝天/夕阳，只允许定性解释；模型不能把简化的 `λ^-4` 计算当作完整大气散射定律。

**分支 C：把衍射、折射和散射混为一谈**

让学生把三张现象卡按“孔径/障碍物边缘、介质边界、微粒/不均匀性”分类，再为每类选一个可观测证据。这个分支优先使用图示和对比实验，不直接追加更多公式。

**分支 D：只会套公式但没有证据**

Tutor 暂停计算，要求补一行“改变了什么—看到了什么—因此支持哪项主张”。如果数据单位、误差或控制变量缺失，`Data Analyst` Agent 只能返回修订建议，不能替学生修改正式作品。

### 4.4 提示阶梯与淡出

1. Level 1：重述任务和变量范围。
2. Level 2：给出对比实验或图中局部标记。
3. Level 3：给出相关定律的符号形式，不代入结果。
4. Level 4：展示一个相似例子，要求学生迁移到当前参数。
5. Level 5：学生明确求助且服务端允许时，提供受限概念/方法解释；仍不输出活动测验最终答案或可抄 CER/报告。记录支架，不直接记掌握。

答对并能说明证据后，下一题减少提示；连续独立完成两次后优先给迁移题。提示等级是 Tutor 投影，不是学生可写入的掌握度字段。

## 5. 实验模型与安全边界

### 5.1 衍射模拟

MVP 只提供受控单缝模型：

```text
sin(θ_m) = mλ/a
Δx ≈ 2λD/a       (小角度、中央亮纹宽度)
I(θ) = I0 (sin β / β)^2
β = πa sin(θ) / λ
```

学生改变 `λ`、`a` 或 `D` 时只改变一个自变量，系统自动记录配置、输出图和观测。应明确“小角近似”和屏幕距离范围；图形是教学模型，不宣称替代真实测量。

### 5.2 散射模拟

MVP 以封闭细雾室的定性比较为主：无雾/有雾、观察角度、光源波长和粒子尺度是受控变量。可显示尺寸参数 `x = 2πr/λ` 和定性 Rayleigh/Mie 区域，但不把简化颜色映射当作精密散射计算。任何真实激光活动都必须有安全外壳、不可直视、教师确认和适龄材料说明。

### 5.3 `OpticsExperimentSpec`（建议合同）

```ts
interface OpticsExperimentSpec {
  experimentId: string;
  version: string;
  mode: 'diffraction' | 'scattering';
  objectiveId: string;
  controls: Array<{
    id: 'wavelength' | 'slitWidth' | 'screenDistance' | 'particleRadius' | 'observationAngle';
    unit: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
  }>;
  observables: Array<'centralBandWidth' | 'firstMinimumAngle' | 'beamVisibility' | 'sizeParameter'>;
  safety: { enclosedBeam: boolean; noDirectViewing: boolean; teacherCheckRequired: boolean };
}
```

学生只能提交合同内的参数和事件；不能上传可执行脚本，不能指定任意工具或修改 `objectiveId`。

### 5.4 运行事件（建议合同）

```ts
interface OpticsExperimentEvent {
  id: string;
  projectId: string;
  sessionId: string;
  experimentId: string;
  experimentVersion: string;
  actionId: string; // 服务端签发的具体实例，不能用动作种类代替
  actionKind: 'set_parameter' | 'run' | 'record_observation' | 'submit_evidence';
  modelVersion: string;
  sourceKind: 'simulation' | 'physical';
  config: Record<string, number>;
  observations?: Array<{ key: string; value: string | number; unit?: string }>;
  evidenceRef?: string;
  idempotencyKey: string;
  createdAt: string;
}
```

这是服务端持久化事件投影，不是允许学生写 id/createdAt/归属的请求体；幂等键从 HTTP header 接收后记录。事件是追加事实，完成/通过/掌握由 owner 判定，不能由 actionKind=run 推导。

## 6. 系统落地映射

| 需求 | 复用现有模块 | 首期改动 |
| --- | --- | --- |
| 项目绑定团队 | `projects` + template binding + Team Runtime | 立项冻结 `bindingId/teamVersionId/hash`，不再按名称猜团队 |
| 大纲与课次 | `learning-plan`、`DeterministicPlanGenerator`、`PlanOutlineStore` | 持久化大纲；12 个核心目标和 DAG 由模板决定，波动模块作为非门禁活动；LLM 只做候选文案 |
| 题目和掌握 | `packages/ai-client` 题库、`TutorQuizService`、`mastery` | 增加散射/衍射题和错误类型；保持单一判分入口 |
| 动态问答 | `ai-tutor`、SSE、`TutorReplyBlock` | 加 `optionId/actionId`、`objectiveId`、策略版本；服务端输出有限 `TutorNextAction` |
| 实验卡 | `optics_experiment` renderer | 扩展 spec/version/controls；把完成回调改为幂等事件，不直接传摘要文本 |
| 项目证据 | `works` / `feedback` / Teacher | 记录变量表、数据、CER、误差和 rubric 引用；Agent 只给候选反馈 |
| 宏观补救 | `plan-adjustment` / `stuck-signal` | 只追加同目标可选补救或建议教师介入，带 revision 和 evidence refs |

推荐的动作联合类型：

```ts
type OpticsTutorNextAction =
  | { kind: 'ask_observation'; objectiveId: string; promptRef: string }
  | { kind: 'ask_prediction'; objectiveId: string; questionRef: string }
  | { kind: 'run_experiment'; experimentId: string; specVersion: string }
  | { kind: 'ask_measurement'; observable: string; unit: string }
  | { kind: 'ask_cer_explanation'; evidenceRefs: string[] }
  | { kind: 'offer_hint'; objectiveId: string; level: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'recommend_remediation'; adjustmentId: string }
  | { kind: 'recommend_teacher_support'; reasonCode: string };
```

模型只能在服务端策略挑选后的 allow-list 内生成文案；它不能返回 `advance_stage`、`mark_mastered`、`approve_artifact` 或任意路由。

## 7. 验收与试点

### 7.1 自动化验收

- 未通过 `TheoryMastered` 时，光学实验块不下发，实践 API 返回明确门禁错误。
- 过期 `experimentVersion`、越界参数、跨项目 `experimentId`、伪造 `objectiveId` 和无权限证据引用全部拒绝。
- 相同 `idempotencyKey` 重放只产生一个事件、一个答案尝试和一个计划 revision。
- 衍射公式、单位换算、中央亮纹趋势和散射尺寸参数有边界/性质测试；极端参数显示“超出模型范围”。
- Quiz 投影不包含答案、解析、错误标签或服务端阈值；开放回答不直接改 mastery。
- SSE 断线可重放；前端覆盖 loading、empty、error、offline、permission-denied 和提交冲突。

### 7.2 试点指标（16 课时为主，四周仅兼容冒烟）

只报告描述统计和安全指标，不在无对照样本时宣称因果效果：

- 证据链完整率：观察、变量、数据、解释、边界是否齐全。
- 概念错误复现率：`inverse_slit_width`、`scattering_visibility`、`diffraction_vs_refraction` 等错误在补救前后是否重复。
- 提示淡出：达到同一目标时 Level 3+ 提示占比和独立作答比例。
- 作品质量：rubric 的变量控制、图表、CER、误差和迁移维度。
- 运行安全：答案泄漏、重复计分、门禁旁路、越权访问、原始敏感对话扩散必须为零。
- 教师可操作性：教师收到最小化卡点摘要后，能否定位目标和证据，而无需查看无关原始对话。

## 8. 研究来源与证据边界

本次使用 Grok Search MCP 做了多轮检索。代表性会话包括：

- `520d804cfa5e`：OpenMAIC 动态规划、Instructor/Evaluator、learner state。
- `443ec4d0194c`：DeepTutor Mastery Path、question card、尝试和补救。
- `9a1959ff33ea`、`52acde66d064`：高中物理 PBL 与单缝衍射变量关系。
- `62d0c27f183c`、`4f36e40ab49b`：适应式脚手架、未成年人隐私与 UNESCO 参考。
- `7b5a8feb44f8`、`8ff760629201`：PBL 证据和光学常见误解。

这些 MCP 响应在本次运行均返回 `sources_count: 0`，不能当作可引用的系统综述或学习效果数字。产品事实以本地仓库快照和源码测试为准；教学原则可复核于：

- OpenMAIC：<https://github.com/THU-MAIC/OpenMAIC>
- DeepTutor：<https://github.com/HKUDS/DeepTutor>
- OpenStax College Physics（波动光学）：<https://openstax.org/details/books/college-physics-2e>
- PhET 模拟：<https://phet.colorado.edu/en/simulations/filter?subjects=physics>
- PBLWorks Gold Standard PBL：<https://www.pblworks.org/what-is-pbl/gold-standard-project-design>
- UNESCO 生成式 AI 教育指南：<https://unesdoc.unesco.org/ark:/48223/pf0000386693>
- UNICEF AI for Children：<https://www.unicef.org/globalinsight/reports/policy-guidance-ai-children>


## 9. 物理正确性与可复现验收补充

### 9.1 单缝模型域

远场、单色、理想单缝的暗纹条件为 a sin(theta_m)=m lambda；屏上精确几何位置 y_m=D tan(arcsin(m lambda/a))，中央宽度为 2 y_1。只有小角时才用 2 lambda D/a；还需远场条件，不能只因参数在滑块范围就视为满足。lambda 使用介质内波长时须说明约定。

以当前默认 lambda=632.8 nm、a=50 um、D=1 m，近似中央宽度 25.312 mm；a 加倍为 100 um 应约减半。上述是模型计算回归样例，绝非实测。sinc 中 beta=0 取连续极限 1；归一化强度不等于绝对亮度或光能总量不变。测试需覆盖单位换算、对称性、暗纹位置、变量趋势、采样分辨率与域外提示。

固定 50 um 不能作为普遍明显/不明显衍射阈值；是否能分辨取决于 lambda/a、几何、仪器/显示分辨率等。远场条件或小角条件不满足时应拒绝该定量模式，或切换另一个已经验证并注册的模型，不能静默截断来伪造规律。

参考：OpenStax [Single-Slit Diffraction](https://openstax.org/books/university-physics-volume-3/pages/4-1-single-slit-diffraction)，本轮 URL HTTP 200；用于物理模型，不作 PBL 效果证据。

### 9.2 散射不是域外继续套用同一公式

尺寸参数若以真空波长 lambda0 定义，应为 x=2 pi n_medium r/lambda0；若使用介质波长则为 2 pi r/lambda。必须记录波长约定/介质。Rayleigh 的 lambda^-4 比较需小粒子与其他条件相同等前提，不是任意粒径/材料/观察角下的通式。

当前默认 r=25 nm、lambda=450 nm、n_medium=1 给 x 约 0.349；代码用 x<0.1 判 Rayleigh，就不能把其余情况直接标成“微粒大于波长、各色均匀乳白”。这里 r 明显仍小于 lambda。完整球形粒子散射还涉及折射率、角度、粒子分布等；现有两个滑块不足以支持普遍精密 Mie 断言。

单色入射的弹性散射不会凭空变成白光。MVP 应先展示粒子使光散向观察者的定性证据，域外显示“本模型不作定量判断”；云雾白色涉及入射光谱/粒子分布等，不能用它给所有单色参数染白。

### 9.3 证据和界面真实性

- 自动计算结果标“模型计算”，学生读图记录标“模拟观察”；真实测量另有仪器/条件/教师安全确认。
- 先记录学生预测，再允许操作，避免自动摘要把待探究规律提前完整写出。
- 按钮收到持久化回执后才称已保存；普通聊天摘要只能显示已发给 AI搭档，不能声称进入作品证据链。
- 引用 supporting textbook 不代表学生独立掌握；CER 需要实际 observation IDs，不能只用教材句子替代数据。
- 不以“结合 OpenMAIC/DeepTutor”文案宣称实际调用了上游系统；本项目借鉴交互模式，并非已经集成其运行引擎。

## 10. 光学任务中的真实 AI 生成

本节是待实施教学行为，不是实际模型请求记录。绑定、Runtime 与传输合同统一遵循 [总架构](./architecture.md)，不在光学模块另建生成引擎。

| 时点 | 真实生成内容 | 固定约束 |
| --- | --- | --- |
| 大纲预览 | 围绕学生生活兴趣生成驱动问题、观察任务与活动情境 | 12 核心目标、审核排期、安全与门禁不变 |
| 进入当前课时 | 责任导师结合已有证据生成本节开场、板书与问题 | 不覆盖 pending，不按固定 1–16 范围猜授权 |
| 学生给出预测 | 生成控制变量的追问和操作建议 | 原始预测保留，不能替学生改正确 |
| 学生提交观测 | 根据已保存读数生成对照、解释和反例 | 仅引用有效 observation IDs，模拟不标实测 |
| CER 与答辩 | 生成证据缺口、模型局限和量规质询 | 不代写最终报告，不自动批准作品 |

单缝任务示例：学生预测“缝越窄，亮纹越窄”，先保存预测；实验向导实际调用模型，生成固定波长和屏距的单变量比较问题。学生提交两组模拟观察后，再围绕其读数实时追问。若混淆亮纹宽度与亮度，下一轮澄清这两个量；若已正确解释，则提出迁移问题，不重复固定提示。

AI 生成参数候选，注册物理模型负责计算，证据 owner 保存参数、模型版本、读数来源和单位。模型不能直接编造模拟输出。散射域外只能生成定性边界说明，不能临时编一个未验证 Mie 求解器。

验收需保存受控实际模型生成 ID、导师和配置版本、provider/model、证据引用及互动结果。相同请求重放不能再次判分或重复保存观测；不同回答必须产生有教学理由的不同下一轮。相关工作项为 G3A、G3B、Q4、E5 和 S6。
