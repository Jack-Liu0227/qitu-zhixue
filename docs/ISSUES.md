# ISSUES 登记册（正式父级 Issue / Register）

> 本文件是启途智学产品与工程事项的**正式父级登记册**。每个条目对应一个可验收任务，
> 对应一个独立分支（见 `CONTRIBUTING.md`）。未在本登记册登记的大范围重构不予受理
> （`AGENTS.md`：「不在没有 Issue 的情况下进行大范围重构」）。
>
> 关联：`docs/ARCHITECTURE.md`、`docs/ADMIN.md`、`docs/STUDENT.md`、`docs/TEACHER.md`、`docs/PARENT.md`。
>
> **GitHub 跟踪**（`Jack-Liu0227/qitu-zhixue`）：父级 `#2`；T8 `#3`、T6 `#4`、T3 `#5`、
> T2 `#6`、T5 `#7`、T7 `#8`、T4 `#9`、T1 `#10`。
>
> **Creation / linking field (gh CLI unavailable fallback)**: if the `gh` CLI or API is
> unavailable, create the Issue manually, then backfill the `GitHub` field in the tables
> below with the issue number and URL. Link a child to its parent with a plain text line
> `Part of #<parent>`; switch to GitHub native sub-issues only once the CLI/API is back.
> The register stays the source of truth either way.

## 0. 元信息

**状态定义**

| 状态 | 含义 |
|---|---|
| `Proposed` | 已登记，待产品/技术评审或排期 |
| `Ready` | 依赖已满足，可开工 |
| `In Progress` | 已认领，分支进行中 |
| `In Review` | PR 已提交，待评审 |
| `Done` | 已合并并满足验收 |
| `Blocked` | 依赖或评审未满足，暂缓 |

**优先级定义**

| 优先级 | 含义 |
|---|---|
| `P0` | 前置治理：不改它，后续会踩错边界或违反 `AGENTS.md` |
| `P1` | 影响产品正确性、隐私或未成年人数据安全 |
| `P2` | 体验与打磨，可后置，但不能无限拖延 |

**范围纪律**：本登记册中的 P0（`ISSUE-P0`）是**纯文档任务**，
不修改应用代码、数据库 schema、迁移或包契约。T1–T8 为产品事项，另行排期。

**范围规则 (project-specific, no AGENTS.md change required)**

1. **No fifth client**: only four clients exist
   (`student-center`, `parent-companion`, `teacher-workspace`, `admin-console`).
   New capability must land in one of them; do not add a new app or entry point.
2. **No frozen IA change without docs/review**: any change to the frozen navigation or
   information architecture requires a product-doc + ADR update and review first
   (`AGENTS.md` baseline, ADR 0004). Hiding an entry in the frontend is not authorization.
3. **No score/rank/percentile/level semantics**: growth, feedback and reminders must not
   introduce scores, rankings, percentiles or level labels for students. Use
   evidence-based, non-judgmental language only.

---

## 1. 父级 Issue

### ISSUE-P0：管理员/班主任职责边界与文档一致性（docs-only）

| 字段 | 内容 |
|---|---|
| ID | `ISSUE-P0` |
| GitHub | [#2](https://github.com/Jack-Liu0227/qitu-zhixue/issues/2) |
| 类型 | 文档 / 治理 |
| 优先级 | **P0** |
| 顺序 | 第 1 位（先于所有 T 项） |
| 状态 | `In Review`（本次文档任务产出，待评审） |
| 依赖 | 无。它是 T7 / T8 的前置 |
| 风险 | 低（仅文档）；但若评审未通过，T7 / T8 不得开工 |
| 影响面 | 产品文档 0.3 / 0.4 / 3.1 / 6.1 / 7.0 / 11.3、`docs/ARCHITECTURE.md`、`docs/PERMISSIONS.md`、新增 ADR 0008、本登记册 |

**交付内容**

1. 修正产品文档中「班主任导航包含系统设置」的过时描述：班主任业务导航为
   工作台、学生管理、问题处理、数据统计、知识库；账号与安全是跨角色账户面；
   平台 / AI 设置归管理员。
2. 明确管理员默认只进入聚合 / 治理视图，不得默认进入个别学生日常处理；
   个别学生日常操作归班主任；管理员个别访问需对象级范围、最小字段、目的 / 原因、
   敏感二次确认、审计、限时。
3. `docs/ARCHITECTURE.md`、`docs/PERMISSIONS.md` 落地该边界，并明确「前端隐藏不是授权」。
4. 新增 `docs/decisions/0008-admin-teacher-boundary.md`（Proposed / Accepted for planning），
   标注实现前提且声明本任务不改任何代码。
5. 新增本登记册，登记 T1–T8、顺序、依赖、风险与 Given/When/Then 验收。

**验收（Given/When/Then）**

- **Given** 阅读产品文档班主任章节，**When** 查看导航描述，**Then** 不再出现「班主任导航含系统设置」。
- **Given** 阅读管理员章节，**When** 查看默认视图，**Then** 明确管理员默认聚合 / 治理、不默认个别学生日常处理。
- **Given** 管理员请求个别学生数据且无对象级范围 / 原因 / 审计，**When** 后端判定，**Then** 应拒绝；文档已写明该规则。
- **Given** 本任务 diff，**When** 检查改动文件，**Then** 仅文档文件变化，无代码 / schema / 迁移 / 包契约改动。

---

## 2. 推荐执行顺序（P0 → P1 → P2）

```text
P0:  ISSUE-P0  （边界与文档一致性，先评审通过）
P1:  T2 → T3 → 反馈闭环持久化 → T5 → T6 → T7 → T8
P2:  T1 → T4
```

**顺序理由**

1. **P0 先行**：`AGENTS.md` 要求冻结 IA 变更必须先改文档并通过评审；T7 / T8 直接依赖本边界。
2. **T2 / T3 与反馈闭环**：先完成低风险、可控范围的提醒、证据化成长反馈和统一反馈持久化/通知基础。
3. **T5 家长导出**：隐私风险最高，需要监护授权、字段最小化、脱敏、审计、异步任务与限时机制；不提前开放认知推断导出。
4. **T6 今日意图分析与确认**：核心正确性规则是未确认不得创建正式项目，必须以服务端确认链和幂等实现。
5. **T7 / T8 导航与职责收敛**：在 P0 和权限审计基础上落实教师设置迁移与管理员治理边界，不让管理员默认进入个体日常处理。
6. **P2：T1 → T4**：先补统一页面转场和 `reduced-motion` 基础，再提供四端基础偏好设置；主题仅允许使用既有 design tokens，不引入任意颜色。

---

## 3. 产品 Issue 登记表（T1–T8）

| ID | GitHub | 标题 | 优先级 | 顺序 | 状态 | 依赖 | 风险 |
|---|---|---|---|---|---|---|---|
| `ISSUE-T2` | [#6](https://github.com/Jack-Liu0227/qitu-zhixue/issues/6) | 轻量、非医疗式的身心状态提醒 | P1 | 1 | `Partial` | 产品 / 隐私评审；提醒持久化与 worker 尚未接入 | 高 |
| `ISSUE-T3` | [#5](https://github.com/Jack-Liu0227/qitu-zhixue/issues/5) | 基于证据的成长正向反馈 | P1 | 2 | `In Review` | 产品文档 4.7 证据模型；AI 不得写档案（4.4） | 中 |
| `ISSUE-FEEDBACK` | [#11](https://github.com/Jack-Liu0227/qitu-zhixue/issues/11) | 反馈闭环持久化和通知补齐 | P1 | 3 | `Partial` | worker 通知投递与真实附件对象存储尚未接入 | 高 |
| `ISSUE-T5` | [#7](https://github.com/Jack-Liu0227/qitu-zhixue/issues/7) | 家长成长旅程 / 认知画像导出 | P1 | 4 | `Partial` | 异步 worker、对象存储、前端下载、清理任务和 step-up re-auth 尚未完成 | 高 |
| `ISSUE-T6` | [#4](https://github.com/Jack-Liu0227/qitu-zhixue/issues/4) | 今日意图分析与确认 | P1 | 5 | `Partial` | 服务端确认链已完成；今天页/灵感页 UI 尚未接线 | 中 |
| `ISSUE-T7` | [#8](https://github.com/Jack-Liu0227/qitu-zhixue/issues/8) | 班主任端平台设置迁移 | P1 | 6 | `Done` | `/teacher/settings` 已移除；账户偏好已归跨角色账户入口 | 中 |
| `ISSUE-T8` | [#3](https://github.com/Jack-Liu0227/qitu-zhixue/issues/3) | 管理员职责收敛 | P1 | 7 | `Partial` | 默认聚合与 fail-closed 已完成；显式原因/二次确认/TTL grant 尚未实现 | 中–高 |
| `ISSUE-T1` | [#10](https://github.com/Jack-Liu0227/qitu-zhixue/issues/10) | 页面转场与减弱动效 | P2 | 8 | `In Review` | 统一转场、reduced-motion 和静态 guard 已完成 | 低 |
| `ISSUE-T4` | [#9](https://github.com/Jack-Liu0227/qitu-zhixue/issues/9) | 四端基础偏好设置 | P2 | 9 | `In Review` | API/UI/迁移已完成；真实 PostgreSQL 集成验证尚未执行 | 低–中 |

> 当前实现状态以本表为准：`Done` 表示验收范围已满足；`In Review` 表示代码与自动化证据已具备，等待独立评审或真实环境验证；`Partial` 表示安全纵切已落地但仍有明确生产/产品 blocker。未完成项不得关闭 GitHub Issue。

### 3.1 实现归属与验证证据 (implementation owner area and validation evidence)

Each T below names its owner area (module / directory) and the evidence required to
validate it. Evidence must be reproducible in the PR that closes the Issue.

| ID | Owner area (module / directory) | Validation evidence |
|---|---|---|
| `ISSUE-T2` | `services/api` AI Tutor + `services/workers` | product/privacy review sign-off; non-medical copy tests; opt-out tests |
| `ISSUE-T3` | `services/api` Growth; student-center growth views | contract tests for `evidenceIds`; "pending observation" render tests; AI-not-write assertions |
| `ISSUE-FEEDBACK` | `services/api` Feedback + `services/workers` outbox; parent/teacher clients | duplicate-submit tests; parent/teacher object-scope 403 tests; outbox retry and audit assertions |
| `ISSUE-T5` | `services/api` Parent Experience + `services/workers` export job; `apps/parent-companion` | guardian 403 tests; redaction tests; audit assertions; export idempotency tests |
| `ISSUE-T6` | `services/api` Projects & Learning; `apps/student-center` today page | state-machine tests (no formal project before confirmation); idempotency-key tests |
| `ISSUE-T7` | `apps/teacher-workspace`; cross-role account surface (`packages/auth`) | nav snapshot test; `/teacher/settings` 404/redirect test; IA review sign-off |
| `ISSUE-T8` | `services/api` access + Admin & Compliance; `apps/admin-console` | API 403 tests; `audit_logs` assertions; admin-console e2e proving aggregate is the default view |
| `ISSUE-T1` | `packages/ui`; four clients | reduced-motion honored; a11y check; non-blocking interaction test |
| `ISSUE-T4` | `packages/ui` + `design-tokens`; account surface in four clients | four-client preference persistence tests; token consistency checks; theme values limited to approved tokens |

---

## 4. 逐条验收标准（Given / When / Then）

### ISSUE-T8 管理员职责收敛（P1，[#3](https://github.com/Jack-Liu0227/qitu-zhixue/issues/3)）

- **Given** 管理员登录，**When** 进入平台管理后台，**Then** 默认落地聚合 / 治理视图，
  不默认进入个别学生日常处理。
- **Given** 管理员需要查看个别学生数据，**When** 发起访问，**Then** 必须提供目的 / 原因、
  限定对象级范围、写审计、带有效时间；敏感读取（原始对话 / 原始语音 / 导出）需二次确认。
- **Given** 管理端前端隐藏了某个入口，**When** 直接请求对应后端接口，**Then** 后端仍按边界
  拒绝（403），不得因为「前端没渲染」而放行。
- **Given** 管理员尝试执行班主任日常操作（如发送干预），**When** 提交，**Then** 后端按边界
  拒绝或要求走显式授权流程，而不是默认允许。

### ISSUE-T6 今日意图分析与确认（P1，[#4](https://github.com/Jack-Liu0227/qitu-zhixue/issues/4)）

- **Given** 学生在今天页表达意图，**When** AI 分析出候选意图，**Then** 展示候选意图并等待学生确认。
- **Given** 学生尚未确认，**When** 系统继续流程，**Then** 不创建正式项目（仅保留探索 / 草稿）。
- **Given** 学生确认，**When** 提交，**Then** 只创建一个项目实例；重复提交因幂等键不产生第二条。
- **Given** 推荐项目保留独立详情/确认、自由探索进入统一 AI搭档，**When** 学生确认意图，**Then** 保留来源类型并由 Projects owner 幂等创建统一项目实例。

### ISSUE-T3 基于证据的成长正向反馈（P1，[#5](https://github.com/Jack-Liu0227/qitu-zhixue/issues/5)）

- **Given** 某能力维度有证据，**When** 生成正向反馈，**Then** 每条反馈携带 `evidenceIds` 且可点回原始记录。
- **Given** 某能力维度证据不足，**When** 展示成长与反馈，**Then** 显示「待观察」而不是 0 分或负面结论。
- **Given** AI 生成建议，**When** 展示或写入，**Then** 建议与人工 / 规则结论在数据和界面上可区分，
  且 AI 不直接写入成长档案。

### ISSUE-T2 轻量、非医疗式的身心状态提醒（P1，[#6](https://github.com/Jack-Liu0227/qitu-zhixue/issues/6)）

- **Given** 学生连续多轮出现情绪挫败信号，**When** 系统触发提醒，**Then** 只给出非诊断、非医疗的
  温和提示（休息 / 求助），不贴标签、不给出医学结论。
- **Given** 触发条件涉及未成年人情绪 / 身心信号，**When** 记录或展示，**Then** 遵循最小可见范围、
  保留审计，且**产品 / 隐私评审通过后**才可上线。
- **Given** 学生关闭或拒绝该类提醒，**When** 后续会话，**Then** 尊重选择，不再默认弹出。

### ISSUE-FEEDBACK 反馈闭环持久化和通知补齐（P1，[#11](https://github.com/Jack-Liu0227/qitu-zhixue/issues/11)）

- **Given** 同一幂等键重复提交反馈，**When** API 重试，**Then** 只有一条工单和一组附件关联。
- **Given** 非授权家长或非负责教师访问工单，**When** 读取或回复，**Then** 返回统一 403 且不泄露资源存在性。
- **Given** 工单写入成功，**When** 事务提交，**Then** 产生可重试的通知 outbox 事件和审计记录。
- **Given** 通知投递失败，**When** worker 重试，**Then** 不重复创建业务工单，最终失败可观测。

### ISSUE-T5 家长成长旅程 / 认知画像导出（P1，高危隐私，[#7](https://github.com/Jack-Liu0227/qitu-zhixue/issues/7)）

- **Given** 家长是已授权监护人，**When** 请求导出，**Then** 需要身份确认，且只导出被授权孩子的脱敏成长数据。
- **Given** 导出内容可能含敏感信息，**When** 生成文件，**Then** 默认不含原始 AI 对话 / 原始语音，并写入审计。
- **Given** 监护授权已被撤销，**When** 再次请求导出，**Then** 返回 403 而非空数据。
- **Given** 导出请求重复提交，**When** 使用同一 `Idempotency-Key`，**Then** 不产生重复导出任务。

### ISSUE-T7 班主任端平台设置迁移（P1，文档 / IA 评审先行，[#8](https://github.com/Jack-Liu0227/qitu-zhixue/issues/8)）

- **Given** `ISSUE-P0`（ADR 0008）与 IA 变更评审通过，**When** 迁移班主任端设置，
  **Then** 班主任业务导航仅为工作台、学生管理、问题处理、数据统计、知识库。
- **Given** 原「系统设置」中的账号与安全能力，**When** 迁移，**Then** 归入跨角色账户面；
  平台 / AI 策略设置归平台管理后台。
- **Given** 迁移完成，**When** 班主任访问原 `/teacher/settings`，**Then** 重定向或返回 404，
  且不暴露不可用能力。

### ISSUE-T4 四端基础偏好设置（P2，[#9](https://github.com/Jack-Liu0227/qitu-zhixue/issues/9)）

- **Given** 任一角色登录，**When** 打开账户 / 偏好入口，**Then** 可设置字号、预设主题、动效和通知偏好；该入口是跨角色账户面，不是平台业务导航。
- **Given** 用户修改偏好，**When** 刷新或在新设备登录，**Then** 偏好按账户持久化并在四端生效；主题值只能来自既有 design tokens。
- **Given** 偏好只含基础设置，**When** 存储，**Then** 不包含未成年人敏感数据，且写操作幂等。

### ISSUE-T1 页面转场与减弱动效（P2，[#10](https://github.com/Jack-Liu0227/qitu-zhixue/issues/10)）

- **Given** 用户未表达动效偏好，**When** 进入 / 离开页面，**Then** 使用统一的短转场且不阻塞交互。
- **Given** 系统或用户开启「减弱动效」，**When** 浏览四端页面，**Then** 关闭非必要位移 / 缩放 / 视差，
  仅保留必要的状态反馈。
- **Given** 动效资源未就绪或设备性能不足，**When** 渲染页面，**Then** 内容仍可读、可操作，不出现空白等待。

---

## 5. 风险登记

| 风险 ID | 关联 | 等级 | 描述 | 缓解 |
|---|---|---|---|---|
| `R-P0` | `ISSUE-P0` | 低 | 边界未评审通过，T7 / T8 提前开工 | 评审通过前 T7 / T8 保持 `Proposed` |
| `R-T2` | `ISSUE-T2` | 高 | 身心 / 情绪提示被误读为医疗建议，或对未成年人贴标签 | 非医疗文案 + 产品 / 隐私评审门禁 + 可关闭 |
| `R-T5` | `ISSUE-T5` | 高 | 导出带出未脱敏未成年人数据 | 监护授权 + 身份确认 + 默认脱敏 + 审计 + 限时 |
| `R-T3` | `ISSUE-T3` | 中 | 证据不足被展示为 0 分或负面结论 | 强制「待观察」；每条结论带 `evidenceIds` |
| `R-T6` | `ISSUE-T6` | 中 | 未确认意图就创建正式项目，破坏核心约束 | 后端状态机 + 幂等键 + 只创建一次 |
| `R-T7` | `ISSUE-T7` | 中 | 迁移触及冻结 IA，导致导航漂移 | 先文档 / 评审；保持五项不变 |
| `R-T8` | `ISSUE-T8` | 中–高 | 管理员默认进入个别学生数据，绕过审计 | 默认聚合视图 + 显式授权 + 审计 + 限时 |
| `R-FE` | 全体 | 中 | 把前端隐藏当作授权 | 后端对象级重判；本登记与 PERMISSIONS §5 明确 |

---

## 6. 变更记录

| 日期 | 变更 | 关联 |
|---|---|---|
| 2026-09-28 | 建立登记册；登记 `ISSUE-P0` 与 T1–T8；确定执行顺序与验收 | ADR 0008 |
| 2026-09-28 | 在 GitHub 建立父级 `#2` 与 T1–T8 对应 Issue `#3`–`#10`，并回填本表 | GitHub |
| 2026-09-28 | 增加项目级范围规则、T1–T8 实现归属与验证证据、gh CLI 不可用时的创建/关联回填方式 | GitHub |

## 7. 新增重构 Issue

| ID | GitHub | 标题 | 状态 | 范围 |
|---|---|---|---|---|
| `ISSUE-STUDENT-SDK-UNIFICATION` | [#14](https://github.com/Jack-Liu0227/qitu-zhixue/issues/14) | 学生端自由探索与 AI搭档统一及 SDK/文档收敛重构 | `In Progress`（实现与清理验证阶段） | 仅 SDK、学生端探索/导师主链路及对应合同、文档；需先完成 IA/架构独立评审。不得据此重写无关平台，也不得删除仍有外部消费者或数据迁移依赖的兼容实现。 |

本 Issue 验收前不得关闭；Issue #2–#11 的状态和关闭条件独立，不因 #14 创建或 PR 合并而自动完成。
