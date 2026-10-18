# 高中物理“光的散射与衍射”PBL 领域方案

> 状态：`proposal / 领域教学与交互设计`
> 日期：2026-10-18
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
- 当前项目总目标数是 **14 个**：探索 2、理论掌握 4、引导实践 6（其中包括 `opt-practice-diffraction` 和 `opt-practice-scattering`）、作品评审 2。仓库中较早的 `docs/pedagogy/optics-pbl.md` 仍写“12 个目标”，应以源码和 `optics-plan.e2e.test.ts` 的 14 个目标为准，后续应修正文档漂移。
- `OPTICS_WAVE_INQUIRY_STEPS` 已定义两个证据优先的模拟提示：固定光源与屏距改变缝宽，以及在封闭细雾室中比较侧向可见性；两者标记为 `TheoryMastered` 前只能模拟，不得把模拟结果当作实践门禁证据。
- `packages/ai-client/src/quiz-bank/optics/misconceptions.ts` 和 `optics-quiz-bank.test.ts` 为现有反射、折射、全反射、透镜题目提供错误类型和补救提示。散射/衍射还需要补充同等粒度的题目、错误类型和开放作答评分。

### 2.2 已有的动态实验原型及其边界

当前工作树已有 `optics_experiment` 结构化块和 `OpticsDiffractionScatteringCard` 原型：

- 服务端 `services/api/src/modules/ai-tutor/tutor-interactive-blocks.ts` 只在光学项目、实践阶段、`TheoryMastered` 已通过时投影实验卡；这符合“理论掌握前不得进入实践”的硬规则。
- 前端 `apps/student-center/features/tutor/components/OpticsDiffractionScatteringCard.tsx` 提供衍射/散射模式切换。衍射模式调节波长 `λ`、缝宽 `a`、屏距 `D`，显示 `sinc²` 形状和中央亮纹宽度；散射模式调节粒子半径与波长，显示尺寸参数和定性 Rayleigh/Mie 判断。
- 当前完成回调仍通过 `onSelectOption` 发送标签和摘要文本，没有稳定的 `actionId`、实验版本、逐步操作事件、观测证据或服务端持久化。因此它是**安全的可视化原型**，还不是可计入 PBL 量规的实验运行时。
- 这张卡的结果应标记为“模型/模拟预测”，不能直接写入 `TheoryMastered`、实验报告通过或成长档案；物理量范围、计算模型和安全文案必须由服务端合同固定，不能由模型生成任意脚本。

### 2.3 网站信息架构上的落点

学生端已有冻结导航：今天、灵感空间、AI 搭档、我的项目、作品展厅、成长轨迹、个人画像。截图和页面代码显示 AI 搭档是三栏工作区（会话、对话、项目/团队状态），项目详情负责阶段与交付物，理论页负责检查题。建议：

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
opt-practice-measure -> opt-practice-diffraction
opt-practice-measure -> opt-practice-scattering
opt-practice-fit + opt-practice-diffraction + opt-practice-scattering
  -> opt-practice-report -> opt-review-defend -> opt-review-reflect
```

散射和衍射目标在实践阶段，但前置的物理概念可以用低风险模拟预演；实践解锁仍由现有 `TheoryMastered` owner 决定。

### 3.3 4 周 / 8 课次建议

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

## 4. 光学专用互动协议

### 4.1 每轮状态机

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
4. 连续两次同类错误只追加同目标补救活动；不降低 `TheoryMastered` 以外的门槛，也不跳过实践证据。

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
5. Level 5：仅在学生明确请求解释且服务端允许时给出完整解释；记录提示依赖，不直接写掌握成功。

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
  actionId: 'set_parameter' | 'run' | 'record_observation' | 'submit_evidence';
  config: Record<string, number>;
  observations?: Array<{ key: string; value: string | number; unit?: string }>;
  evidenceRef?: string;
  idempotencyKey: string;
  createdAt: string;
}
```

事件是追加式事实；“实验完成”“作品通过”“掌握”必须由对应 owner 根据证据计算，不能由 `actionId = run` 推导。

## 6. 系统落地映射

| 需求 | 复用现有模块 | 首期改动 |
| --- | --- | --- |
| 项目绑定团队 | `projects` + template binding + Team Runtime | 立项冻结 `bindingId/teamVersionId/hash`，不再按名称猜团队 |
| 大纲与课次 | `learning-plan`、`DeterministicPlanGenerator`、`PlanOutlineStore` | 持久化大纲；14 个目标和 DAG 由模板决定；LLM 只做候选文案 |
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

### 7.2 四周试点指标

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

