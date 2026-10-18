# 自适应 PBL 与多智能体协同融合方案（Combined Proposal）

> **文档标识**：`docs/plan/combined/README.md`  
> **版本**：v1.0.0  
> **生效基线**：2026-10-18  
> **方案来源**：综合评估与融合 [`../antigravity/`](../antigravity/) 与 [`../codex/`](../codex/) 两套方案  
> **责任领域**：`projects` / `learning-plan` / `ai-tutor` / `mastery` / `team-runtime` / `apps/student-center`  

---

## 1. 文档索引

1. **架构设计方案**：[`./architecture.md`](./architecture.md)
   * 拓扑结构与数据流图
   * 核心契约与数据结构（绑定快照、大纲节点、交互块协议、教学动作）
   * 双循环教学交互机制与硬门禁状态机
2. **实施落地计划**：[`./implementation-plan.md`](./implementation-plan.md)
   * 目标闭环与分阶段实施路线图（P0 至 P5）
   * 分阶段任务分解（WBS）与代码落地地图
   * 质量门禁与验证命令

---

## 2. 方案对比矩阵 (Comparison Matrix)

| 评估维度 | Antigravity 方案 (`docs/plan/antigravity/`) | Codex 方案 (`docs/plan/codex/`) | 融合方案 (`docs/plan/combined/`) |
| :--- | :--- | :--- | :--- |
| **系统架构定位** | 偏向独立 PBL 服务与新数据流 | 坚持现有模块化单体与现有领域 | **收敛在现有单体内，单体所有权强管控** |
| **团队与模板绑定** | 动态具象化，重视运行时调度 | 强调版本化、不可变绑定与快照冻结 | **采纳不可变团队版本 + 立项快照冻结机制** |
| **大纲与计划模型** | 新设平行 `PblSyllabus` 与 `PblProjectPlan` | 复用 `learning-plan` 与 `PlanOutline` | **复用既有大纲模型，增量扩展补救微节点与版本锁** |
| **交互组件协议** | 详尽定义 OpenMAIC 多模态交互资产块 | 仅提出建议，复用基础 Tutor 卡片 | **完整集成 OpenMAIC 结构化卡片与沙箱受控渲染** |
| **苏格拉底问答** | 引入 DeepTutor 迷思诊断与 3 级提示阶梯 | 强调服务端单一判分与防答案泄露 | **结合迷思选项驱动 + 三级提示阶梯 + 服务端判分** |
| **自适应调谐** | 宏观大纲重构，支持插入补救节点 | 保守阈值，仅追加可选练习，依赖人工确认 | **双循环调谐：微观提示递进 + 宏观有审计补救追加** |
| **模型权限边界** | 允许模型生成复杂多模态指令 | 严格限制模型为候选生成者，禁止改写状态 | **坚守模型无状态写权原则，状态由 Owner 强校验** |
| **工程落地成本** | 高（需重写大量既有课程与计划持久化） | 低至中（偏向保守防御，前端表现力较弱） | **可控且最优（向后兼容增量开发，交互体验丰富）** |

---

## 3. 融合方案采用原因 (Rationale for Adoption)

### 3.1 消除架构膨胀与数据双写隐患
原 Antigravity 方案提出了独立的 `pbl_syllabi`、`pbl_syllabus_nodes` 与 `pbl_project_plans` 体系，这与启途智学已有的 `learning-plan`、`PlanOutline`、`project_template_versions` 存在重叠。若直接采用，势必导致“学生在研项目有两套大纲数据”的双写和一致性风险。  
融合方案采纳 Codex 的单体收敛原则，将大纲与计划统一收敛至既有 `learning-plan` 领域内，以扩展字段（`isRemedial` 标识、乐观锁 `baseRevision`）实现动态自适应，保留单一数据权威源。

### 3.2 补齐前端 PBL 探究的具身与多模态体验
原 Codex 方案偏向后端工程防御，对学生端在探究学习中的交互形态未作具体展开，仅依赖通用文本和基础卡片，易使 PBL 学习体验退化为普通问答对话。  
融合方案完整采纳 Antigravity 提出的 OpenMAIC 交互资产协议（`QuizBlock`、`OptionsBlock`、`BoardBlock`、`SimulationBlock`、`MilestoneBlock`）以及直观的三级提示阶梯栏（`HintLadderBar`），赋予学生在概念推导、公式演算和参数仿真中的沉浸式交互能力。

### 3.3 坚守“状态权威在服务端”与“未成年人数据安全”红线
融合方案完全继承并强化了两份方案中的核心安全门禁：
* **意图确认门禁**：学生未明确确认意图前不得立项。
* **`TheoryMastered` 强硬门禁**：理论掌握度未达标前硬拦截实践工具与代码沙箱。
* **模型输出沙箱化**：大模型生成内容仅作为候选（Candidates），严禁直接写入项目状态、掌握度、成长档案或审计日志。
* **隐私最小化**：向教师端推送的卡点信息经过脱敏摘要处理，禁止在通知中包含学生未成年人原始对话内容。

### 3.4 契合现有 Monorepo 演进路线，迁移成本最低
既有契约（[packages/contracts/src/tutor.ts](file:///z:/Study/qitu-zhixue/packages/contracts/src/tutor.ts)）、前端组件（[apps/student-center/features/tutor/TutorPage.tsx](file:///z:/Study/qitu-zhixue/apps/student-center/features/tutor/TutorPage.tsx)）和后端模块均采用平滑扩展方式演进，无需对既有业务代码进行大范围重构，保证当前版本与在研分支的安全稳定。
