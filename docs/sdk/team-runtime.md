# Team Runtime SDK Contract

The server runs one Tutor Agent as the Team leader. Child Agents receive typed
delegate tasks through the server mailbox and return typed results. They do not
open independent student sessions and they do not write domain records directly.

## Agent definition

`AgentConfig` has four distinct concerns:

- `mission` (and the compatibility `roleDefinition`) explains why the Agent exists.
- `constraints` describes required and forbidden behavior. Constraints marked
  `server` or `domain` must be enforced by services, not only placed in a prompt.
- `dataScopes`, `skillIds`, `toolIds` and `routes` define the capabilities that
  the server binds to the Agent.
- `model` selects the provider and model directly for this Agent.

All Agents reference one `globalPolicy`, representing the repository/server
`AGENTS.md`. A child Agent does not need its own `AGENTS.md`; the optional
`agentDefinition` field is retained only for existing records and compatibility.

## Delegation and mailbox

`TeamRun`, `TeamTask`, `TeamMessage` and `TeamEvent` are versioned with
`qitu.team-runtime.v1`. `createTypedAgentDelegate` is the SDK boundary for
leader-to-child calls. It checks the server-resolved recipient allow-list and
verifies the returned run, task, task kind and correlation identifiers.

The first typed task kinds are `interest.confirmation`,
`project.recommendation`, `pbl.plan`, `pbl.advance`, `project.review`,
`profile.generate` and `growth.record`. Profile and growth results are
projections; the owning domain service remains responsible for validation,
idempotent persistence and audit records.

## Graph projections

`StaticAgentGraph` shows configured Agents and allowed routes. `DynamicAgentGraph`
shows executions and mailbox edges for one Team Run. Both are read projections;
the browser must not use graph data to bypass authorization or write state.

## Provider import and voice

`createProviderImportManifest` accepts an unknown pi catalog and returns a
credential-free `ProviderImportManifest`. It strips credential fields and URL
user info/query/fragment; auth is represented only by a configured flag and an
optional one-way fingerprint. Server-side credential resolution remains a
separate operation.

`VoiceGateway` keeps ASR, TTS and realtime selection separate from text
`ModelRuntime`. `createVoiceGateway` validates request shape and delegates to a
server-owned provider adapter. Voice model descriptors expose capabilities and
credential status, never credentials.

Voice presets are catalog metadata only. The API now deploys a Qwen
OpenAI-compatible `VoiceGatewayProvider` for explicitly declared audio models.
The server still reports a model as unavailable until the provider credential is
present, the model declares audio input/output, and the upstream `/models`
probe confirms that model. A preset must not by itself bind `tutor.live` or
claim that audio requests can run.

When a Qwen (or other) model catalog omits input/output modality metadata, the
importer keeps the model text-only (`input: ['text']`, `output: ['text']`) and
sets voice capability to `null`. It must not infer audio support from an id,
name, or provider preset; an administrator may add an explicit, audited audio
declaration after verifying the upstream adapter.

## Admin 助手 / 团队 CRUD 契约

> 本节是 **T1 冻结契约**。唯一事实源是 `packages/contracts/src/team-runtime.ts`
> （从「Admin 助手 / 团队 CRUD —— 写入侧 DTO」注释块起）。T2（服务端持久化）、
> T3（团队编排）、T4（前端）逐字照抄类型名与字段名：**不得改名、不得增删字段**。
> 全部类型按名从 `@qitu/contracts` 导入：
> `import type { AdminAssistantCreateInput, AdminTeamUpdateInput } from '@qitu/contracts';`

### 1. 端点与响应信封

响应信封统一 `{ data: ... }`（对齐 `apps/admin-console/lib/api/types.ts` 的 `DataEnvelope`）。
错误响应统一走仓库唯一的 `ProblemDetails`（`packages/contracts/src/errors.ts`）。

| # | 方法与路径 | 请求体类型 | 响应类型（已冻结） | 幂等 |
|---|---|---|---|---|
| 1 | `GET /api/v1/admin/ai-runtime/assistants` | — | `AdminAssistantListResponse` | 否 |
| 2 | `POST /api/v1/admin/ai-runtime/assistants` | `AdminAssistantCreateInput` | `AdminAssistantResponse`（201） | **必须** |
| 3 | `PATCH /api/v1/admin/ai-runtime/assistants/:id` | `AdminAssistantUpdateInput` | `AdminAssistantResponse`（200） | **必须** |
| 4 | `GET /api/v1/admin/ai-runtime/teams` | — | `AdminTeamListResponse` | 否 |
| 5 | `POST /api/v1/admin/ai-runtime/teams` | `AdminTeamCreateInput` | `AdminTeamResponse`（201） | **必须** |
| 6 | `PATCH /api/v1/admin/ai-runtime/teams/:id` | `AdminTeamUpdateInput` | `AdminTeamResponse`（200） | **必须** |

```ts
export interface AdminAssistantListResponse { data: AdminAssistantConfig[] }
export interface AdminAssistantResponse     { data: AdminAssistantConfig }
export interface AdminTeamListResponse      { data: AdminTeamConfig[] }
export interface AdminTeamResponse          { data: AdminTeamConfig }
```

权限：6 个端点**仅 `admin` 角色**可用（`requireRole(auth, cookie, 'admin', …)`，与
`services/api/src/modules/team-runtime/team-runtime.controller.ts` 的现有写法一致）。
前端隐藏入口只是显示控制；服务端必须对每个资源对象再校验一次权限。

### 2. 幂等：只走请求头

本节的六条 admin 助手/团队路由：幂等键**一律**通过 HTTP 头 `Idempotency-Key` 传递，
**不放进 body**；body 中出现 `idempotencyKey` 属于未知字段，必须被拒绝。
（其它端点存在 body 回退的既有例外，见下方「幂等键取法：header-only 与已知例外（F4）」。）

```ts
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

export const ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES = {
  assistantCreate: 'admin.ai-runtime.assistant.create',
  assistantUpdate: 'admin.ai-runtime.assistant.update',
  teamCreate: 'admin.ai-runtime.team.create',
  teamUpdate: 'admin.ai-runtime.team.update',
} as const;
```

4 个作用域的用法（更新类作用域必须拼资源 id，避免不同资源共用同一条幂等记录）：

| 端点 | scope |
|---|---|
| `POST /assistants` | `ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.assistantCreate` |
| `PATCH /assistants/:id` | `` `${ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.assistantUpdate}:${id}` `` |
| `POST /teams` | `ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.teamCreate` |
| `PATCH /teams/:id` | `` `${ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.teamUpdate}:${id}` `` |

键规则与现有一致：`trim` 后非空且 ≤ 160 字符；缺失 → `400` `IDEMPOTENCY_KEY_REQUIRED`；
同键不同载荷 → `409` `IDEMPOTENCY_CONFLICT`；同键同载荷 → 回放首次结果（不重复写入）。

### 3. 助手写入 DTO

```ts
export interface AdminAssistantCreateInput {
  name: string;                          // 必填
  description: string;                   // 必填
  role: string;                          // 必填
  instructions: string;                  // 必填
  avatar?: string;
  modelProviderId?: string | null;
  modelId?: string | null;
  temperature?: number;
  enabledSkills?: readonly string[];
  toolIds?: readonly string[];
  mcpServerIds?: readonly string[];
  defaults?: Partial<AssistantDefaults>;
  teamSelectable?: boolean;
  sortOrder?: number;
  enabled?: boolean;
}

export interface AdminAssistantUpdateInput {   // PATCH：字段全部可选
  name?: string;
  description?: string;
  role?: string;
  instructions?: string;
  avatar?: string;
  modelProviderId?: string | null;
  modelId?: string | null;
  temperature?: number;
  enabledSkills?: readonly string[];
  toolIds?: readonly string[];
  mcpServerIds?: readonly string[];
  defaults?: Partial<AssistantDefaults>;
  teamSelectable?: boolean;
  sortOrder?: number;
  enabled?: boolean;
}
```

必填 / 可选一览（助手）：

| 字段 | Create | Update | 说明 |
|---|---|---|---|
| `name` | 必填 | 可选 | 去空白后 1–40 字符 |
| `description` | 必填 | 可选 | 一句话职责说明 |
| `role` | 必填 | 可选 | 职责标签，例如 `Concept Coach / 概念教练` |
| `instructions` | 必填 | 可选 | 教师指令正文；客户端不得借此写入项目状态或审计字段 |
| `avatar` | 可选 | 可选 | — |
| `modelProviderId` | 可选（可为 `null`） | 可选（可为 `null`） | — |
| `modelId` | 可选（可为 `null`） | 可选（可为 `null`） | — |
| `temperature` | 可选 | 可选 | `0–2` |
| `enabledSkills` / `toolIds` / `mcpServerIds` | 可选 `readonly string[]` | 可选 | POST 默认 `[]` |
| `defaults` | 可选 `Partial<AssistantDefaults>` | 可选 | 只允许覆盖已知默认项 |
| `teamSelectable` | 可选，默认 `true` | 可选 | `false` 时不出现在团队可选列表 |
| `sortOrder` | 可选，默认追加到末尾 | 可选 | — |
| `enabled` | 可选，默认 `true` | 可选 | — |

`Partial<AssistantDefaults>` 的写入子集形状（逐字段可选）：

```ts
model?:         { mode: string; value?: string }            // AssistantDefaultScalar
permission?:    { mode: string; value?: string }
thought_level?: { mode: string; value?: string }
skills?:        { mode: string; value: readonly string[] }  // AssistantDefaultList
mcps?:          { mode: string; value: readonly string[] }
```

**服务端补全（客户端不得提交）**：

| 字段 | POST 取值 | 说明 |
|---|---|---|
| `id` | 服务端生成 | 写入 DTO 里没有 `id`；`:id` 只出现在 PATCH 路径 |
| `source` | `'user'` | 客户端不能自称 `'builtin'` / `'generated'` |
| `deletable` | `true` | 由 `source` 派生，非入参 |
| `agentStatus` | `'unchecked'` | 运行态，由探活写回 |
| `agentStatusMessage` | 省略 | 运行态 |
| `createdAt` / `updatedAt` | 服务端时间戳 | 非入参 |

PATCH 语义：空补丁（0 个字段）必须 `400` 拒绝；`source: 'builtin'` 的助手只允许改展示与
模型相关字段，`instructions` 的改写必须由服务端记审计。

### 4. 团队写入 DTO

```ts
export interface AdminTeamCreateInput {
  name: string;                                  // 必填
  description: string;                           // 必填
  leaderAssistantId: string;                     // 必填
  members: readonly AdminTeamMemberInput[];      // 必填，长度 >= 1
  workspaceMode?: WorkspaceMode;                 // 默认 'shared'
  sessionMode?: TeamSessionMode;                 // 默认 'supervised'
  concurrencyLimit?: number;                     // 默认 1，范围 1–8
  pblSpec?: AdminTeamPblSpecInput;
  enabled?: boolean;                             // 默认 true
}

export interface AdminTeamUpdateInput {          // PATCH：字段全部可选
  name?: string;
  description?: string;
  leaderAssistantId?: string;
  members?: readonly AdminTeamMemberInput[];
  workspaceMode?: WorkspaceMode;
  sessionMode?: TeamSessionMode;
  concurrencyLimit?: number;
  pblSpec?: AdminTeamPblSpecInput;
  enabled?: boolean;
}

export interface AdminTeamMemberInput {
  slotId?: string;                 // 省略则由服务端生成稳定 slotId
  assistantId: string;             // 必填
  role: TeammateRole;              // 必填：'leader' | 'teammate' | 'reviewer' | 'coach'
  roleLabel?: string;              // 缺省取该助手配置的 role
  model?: string;                  // 缺省取解析出的模型 id
  color?: string;
  pblPhase?: PblPhase;             // 'exploration' | 'concept_mastery' | 'guided_practice' | 'deliverable_review'
}
```

必填 / 可选一览（团队）：

| 字段 | Create | Update | 说明 |
|---|---|---|---|
| `name` | 必填 | 可选 | — |
| `description` | 必填 | 可选 | — |
| `leaderAssistantId` | 必填 | 可选 | 必须命中 `members` 中某个 `assistantId` |
| `members` | 必填（≥ 1） | 可选 | **整体替换语义**，见硬规则 2 |
| `workspaceMode` | 可选，默认 `'shared'` | 可选 | `'shared' \| 'isolated'` |
| `sessionMode` | 可选，默认 `'supervised'` | 可选 | `'auto' \| 'plan' \| 'supervised'` |
| `concurrencyLimit` | 可选，默认 `1` | 可选 | `1–8` |
| `pblSpec` | 可选 | 可选 | 见第 5 小节 |
| `enabled` | 可选，默认 `true` | 可选 | — |

**服务端补全 / 派生（客户端不得提交）**：`id`、`createdAt`、`updatedAt`，以及成员的
`assistantName`、`avatar`（按 `assistantId` 从助手表解析回填）、`status`
（`TeammateStatus` 属运行态，写侧完全不暴露）。

团队取值校验：`members.length >= 1`；`leaderAssistantId` 必须命中 `members`；
每个 `assistantId` 必须存在且 `enabled` 且 `teamSelectable`；`concurrencyLimit ∈ 1–8`；
`workspaceMode` / `sessionMode` / `role` / `pblPhase` 必须是上述字面量枚举；未知字段 `400`。

### 5. PBL 工作流写入 DTO —— 门禁只可加强

```ts
export type PblGateCondition =
  | 'student_confirmed_intent'
  | 'TheoryMastered'
  | 'code_playable_run_verified'
  | 'review_completed_and_archived';

export interface AdminTeamPblSpecInput {
  projectId: string;                         // 必填
  projectName: string;                       // 必填
  targetDomain: string;                      // 必填
  phases: readonly AdminTeamPblPhaseInput[]; // 必填
  theoryMasteredGate: true;                  // 必填，且只能是字面量 true
  allowAutonomousAdvance?: false;            // 只能是 false 或省略
}

export interface AdminTeamPblPhaseInput {
  phase: PblPhase;                           // 必填
  title: string;                             // 必填
  assignedAssistantId: string;               // 必填
  assignedRoleLabel?: string;
  learningObjectives?: readonly string[];
  gateCondition?: PblGateCondition;
  deliverableType?: string;
}
```

`gateCondition` 省略时，服务端按阶段补默认门禁：

| `phase` | 默认 `gateCondition` |
|---|---|
| `exploration` | `student_confirmed_intent` |
| `concept_mastery` | `TheoryMastered` |
| `guided_practice` | `code_playable_run_verified` |
| `deliverable_review` | `review_completed_and_archived` |

读取侧 `PblPhaseSpec` 保持原样（`gateCondition: string`、`theoryMasteredGate: boolean`），
因此 `THUNDER_FIGHTER_PBL_SPEC` 仍是合法的读取投影；**写入侧**用 `PblGateCondition` 联合
类型 + `theoryMasteredGate: true` 字面量把门禁钉死。

### 6. 两条硬规则

1. **门禁只可加强、不可削弱。** `theoryMasteredGate` 在写入形状里是字面量 `true`，
   `allowAutonomousAdvance` 只接受 `false` 或省略；`concept_mastery` 阶段的
   `gateCondition` **必须**等于 `TheoryMastered`，服务端强校验。任何把它写成 `false`、
   `undefined`、一个 `boolean` 变量或其他门禁的载荷都必须 `400` 拒绝——
   「`TheoryMastered` 之前不得进入实践阶段」是 AGENTS.md 硬约束，不能因为管理端配置而失效。
   类型层的约束只是第一道防线（编译期约束不了 JSON），服务端解析必须独立复校。
2. **`members` 是整体替换语义，不是增量 diff。** `PATCH /teams/:id` 带 `members` 时，
   提交的数组就是替换后的完整成员集合：删成员＝不再出现，改成员＝原地修改，
   新增成员＝不带 `slotId` 出现。服务端不得与旧集合做 merge，也不得因为「少传了一个成员」
   而保留它；替换后 `leaderAssistantId` 必须仍命中该集合。

### 7. 种子来源与内置实体

- 内置助手：`@qitu/ai-client` 的 `BUILTIN_ASSISTANTS` —— `tutor-leader`、
  `fighter-concept-coach`、`fighter-code-guide`、`fighter-review-assessor`，
  均为 `source: 'builtin'`、`deletable: false`。
- 内置团队：`THUNDER_FIGHTER_TEAM_CONFIG`（`id: 'team-thunder-fighter-pbl'`，成员来自
  `THUNDER_FIGHTER_TEAM_MEMBERS`），PBL 规格为 `THUNDER_FIGHTER_PBL_SPEC` /
  `THUNDER_FIGHTER_PHASES`：`exploration → concept_mastery → guided_practice →
  deliverable_review`，门禁链
  `student_confirmed_intent → TheoryMastered → code_playable_run_verified → review_completed_and_archived`。
- 导入面（**按名导入，禁止改名**）：`BUILTIN_ASSISTANTS`、`THUNDER_FIGHTER_TEAM_CONFIG`、
  `THUNDER_FIGHTER_PBL_SPEC`、`THUNDER_FIGHTER_TEAM_MEMBERS`、`THUNDER_FIGHTER_PHASES`、
  `AssistantRegistry` / `createAssistantRegistry`、`TeamOrchestrator` / `createTeamOrchestrator`。
  前三个是 T2/T3/T4 的种子判据；`apps/admin-console` 已在用，改名即为破坏性变更。
- 内置实体不可删除；内置助手的 `PATCH` 只允许改展示与模型相关字段。

### 8. 状态码约定

| 情况 | 状态 | `ProblemDetails.code` |
|---|---|---|
| 缺少幂等键 | 400 | `IDEMPOTENCY_KEY_REQUIRED` |
| 未知字段 / 取值非法 / 空补丁 / 门禁被削弱 | 400 | 校验码（见下方说明） |
| 未登录 | 401 | `UNAUTHENTICATED` |
| 非 admin 角色 | 403 | 权限码 |
| 助手或团队不存在 | 404 | `*_NOT_FOUND` |
| 同幂等键不同载荷 | 409 | `IDEMPOTENCY_CONFLICT` |

`IDEMPOTENCY_KEY_REQUIRED`、`IDEMPOTENCY_CONFLICT`、`UNAUTHENTICATED` 已在 `ApiErrorCode`
冻结；`*_NOT_FOUND` 与助手/团队专属校验码若需要固化，由 T2 以附加项补进 `ApiErrorCode`
（该联合类型声明为 additive-only，只能加不能改）。

## Team Run `context` 与阶段真源

**契约语义**：`context` 是客户端**可传但受键白名单约束**的输入；阶段与门禁字段
**禁止客户端写入**。这条约束由**服务端强制**（解析层 + 服务层双重校验，在任何
数据库写入前报错 → 被拒请求 0 insert），不是 prompt 约定，也不是可被管理端配置
打开的开关。

### 服务端常量（逐字，出处 `packages/ai-client/src/pbl-team.ts`）

`TEAM_RUN_CONTEXT_RESERVED_KEYS`（`pbl-team.ts:141-153`）——在 `context` 里出现即 400：

```ts
['phase', 'pblPhase', 'gates', 'gate', 'gateEvidence', 'satisfiedGates',
 'theoryMastered', 'theoryMasteredGate', 'allowAutonomousAdvance', 'pblSpec', 'context']
```

`TEAM_RUN_CONTEXT_ALLOWED_KEYS`（`pbl-team.ts:155-161`）——白名单，未列出的键 400：

```ts
['turnCount', 'pedagogicMove', 'intentDraftId', 'topic', 'source']
```

`turnCount` / `pedagogicMove` 是既有 AI 搭档链路已在传的服务端派生观测字段
（`services/api/src/modules/ai-tutor/tutor.service.ts:498` `executeTurn` → `:509` 算 `turnCount`
→ `:523` `context: { turnCount, pedagogicMove }`）；`intentDraftId` / `topic` / `source` 是
意图草稿与溯源（traceability）类非状态字段。

`PBL_INITIAL_PHASE`（`pbl-team.ts:167`）= `PBL_PHASE_ORDER[0]` = `'exploration'`：
服务端初始化阶段时写入的值（`startRun` → `team-runtime.service.ts:554`
`context: { ...clientContext, phase: PBL_INITIAL_PHASE }`）。「阶段缺失」必须被理解为
**还在首阶段**，绝不能当作「已走到终点」而绕过门禁（`readRunPhaseContext`，
`team-runtime.service.ts:354-357`）。

### 错误码

| 情况 | 状态 | `code` | 抛错点 |
|---|---|---|---|
| `context` 不是对象（或是数组） | 400 | `TEAM_CONTEXT_INVALID` | `team-runtime.service.ts:329` |
| 命中保留的状态键 | 400 | `TEAM_CONTEXT_RESERVED_KEY` | `team-runtime.service.ts:335` |
| 白名单外的未知键 | 400 | `TEAM_CONTEXT_UNKNOWN_KEY` | `team-runtime.service.ts:342` |
| `run.context.phase` 值非法/伪造 | 409 | `PBL_PHASE_ORDER_INVALID` | `team-runtime.service.ts:361` |
| 声称的阶段**缺少前置门禁证据**（历史脏数据） | 409 | `PBL_PHASE_ORDER_INVALID` | `team-runtime.service.ts:375` |

码字面量定义：`pbl-team.ts:110`（`PHASE_ORDER_INVALID`）、`:115`、`:117`、`:119`。
校验函数 `sanitizeTeamClientContext`（`team-runtime.service.ts:326`）在两处调用：
解析层 `team-runtime.controller.ts:200` 与服务层 `startRun`（`:494`）；合法时**只返回
白名单副本**（`:346-350`），非白名单字段不会落库。

### 阶段只能按冻结顺序推进，只有服务端能改

- 全仓**唯一**改写 `context.phase` 的地方是 `advancePhase`（`team-runtime.service.ts:880`）；
  `startRun` 只会写 `PBL_INITIAL_PHASE`。
- `POST /api/v1/tutor/team-runs/:runId/phase`（`team-runtime.controller.ts:117`）：目标阶段必须
  等于 `nextPblPhase(currentPhase)`（`pbl-team.ts:193-198`），否则 409 `PBL_PHASE_ORDER_INVALID`
  （抛错点 `team-runtime.service.ts:203-211`）；终阶段无后续，也不能再推。
- 门禁是**累积判定**：进入目标阶段需要其之前所有阶段的门禁均已达成
  （`pblGatesRequiredToEnter` `pbl-team.ts:206-210`；`evaluateGateEntry` `team-runtime.service.ts:169`），
  因此进入 `guided_practice` 需要 `student_confirmed_intent` **且** `TheoryMastered`。
- 证据只认服务端写入的 `team.gate.satisfied` 事件（主题常量 `team-runtime.service.ts:57`；
  重放集合 `loadSatisfiedGates` `:986-996`），写入入口唯一：
  `POST /api/v1/admin/agent-runs/:runId/gates`（`team-runtime.controller.ts:140`，仅 admin `:147`，
  非 admin/服务端走域逻辑则 409 `TEAM_GATE_WRITE_FORBIDDEN`，`team-runtime.service.ts:776`）。
- 自动推进永远被拒：`allowAutonomousAdvance = false` 派生成常量
  `PBL_AUTONOMOUS_ADVANCE_ALLOWED`（`pbl-team.ts:173`），`trigger: 'autonomous'` → 409
  `PBL_AUTONOMOUS_ADVANCE_FORBIDDEN`（`team-runtime.service.ts:193-202`）。
- 门禁未达成的稳定阶段码（409，`pbl-team.ts:101-106`）：
  `PBL_GATE_STUDENT_INTENT_REQUIRED` / `PBL_GATE_THEORY_MASTERED_REQUIRED` /
  `PBL_GATE_CODE_RUN_NOT_VERIFIED` / `PBL_GATE_REVIEW_NOT_ARCHIVED`；拒绝同时落
  `team.gate.blocked` 事件（`team-runtime.service.ts:853-864`）。
- 委派也受门禁：携带 `pblPhase` 的 delegate 先过门禁再过阶段一致性
  （`decideDelegatedPhaseEntry` `team-runtime.service.ts:230`；拒绝写事件 `:632-637`，不一致则
  409 `TEAM_PHASE_MISMATCH`）。
- 读取侧（客户端只读）：`GET /api/v1/tutor/team-runs/:runId/phase`
  （`team-runtime.controller.ts:107` → `getPhaseStatus` `team-runtime.service.ts:803-825`）返回
  `phase` / `phaseOrder` / `nextPhase` / `currentGate` / `requiredGateForNext` /
  `nextGateErrorCode` / `satisfiedGates` / `allowAutonomousAdvance` / `theoryMasteredGate`。

## 当前班主任唯一性（一个学生同时只能有一个）

AGENTS.md 硬约束。两层实现，缺一层都不算完成：

**服务层判定**（`decideMentorUniqueness` `team-runtime.service.ts:291-312`，调用点 `:511-531`）：

1. `Idempotency-Key` 命中已有 run → 直接重放（`:504-507`）。
2. 活跃 run 定义：同 `student_user_id` 且 `status IN ('queued', 'running')`（查询 `:512-519`）。
3. 同 leader + 同 `tutorSessionId` + 同 `projectId` → 幂等重放既有 run（`:305-310`）。
4. 任一活跃 run 的 leader 与请求不同 → 409 `TEAM_MENTOR_UNIQUENESS_CONFLICT`
   （`:296-303`；码 `pbl-team.ts:113`），绝不允许出现两个当前班主任。

**DB 层兜底**（并发两个 `startRun` 可同时通过上面的 check-then-insert，即 TOCTOU）：
迁移 `database/migrations/0021_agent_team_run_mentor_uniqueness.sql:16-18` 已落地：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_runs_active_mentor_unique_idx"
  ON "agent_team_runs" ("student_user_id")
  WHERE "status" IN ('queued', 'running');
```

- 部分唯一索引：只约束活跃行；终态（completed / failed / cancelled）不在 `WHERE` 内，
  历史 run 不受影响。
- `student_user_id IS NULL`（无学生归属的服务端 run）不受约束：Postgres 唯一索引默认
  NULLS DISTINCT，多个 NULL 行可共存。
- Drizzle schema 同步声明：`packages/database/src/schema/team-runtime.ts:51-53`
  （`activeMentorUniqueIdx`，同名 + `.where(sql\`status IN ('queued', 'running')\`)`）。
- 若库里已存在同一学生的多行活跃 run，**索引创建会失败并阻断迁移**（有意的：先修数据
  再升级，不做静默去重）。回滚仅移除索引（`0021_agent_team_run_mentor_uniqueness.down.sql:4`）。
  （该迁移原拟编号 0020，因 local main 已用 `0020_enable_team_agents`（journal idx 20）而
  **重编号为 0021**（journal idx 21 / when=1791676800000）；索引名与谓词不变。）
- 服务层把 Postgres `23505` 翻译成 409：`isUniqueViolationError`（`team-runtime.service.ts:276-279`）
  在 `startRun` 的 catch 里使用（`:572-608`）。注意 insert 的 `ON CONFLICT DO NOTHING` 只仲裁
  `idempotency_key`，所以 `23505` 只能来自班主任索引；事务已整体回滚（本次未留下任何
  run 行、邮箱或审计）。回读胜者后：同 leader+同会话+同项目 → 重放胜者（`:604`），
  其余情形一律 409 `TEAM_MENTOR_UNIQUENESS_CONFLICT`（`:592` / `:608`）。

## 幂等键取法：header-only 与已知例外

上节「Admin 助手 / 团队 CRUD 契约」的六条 admin 路由：**只认 `Idempotency-Key` 头**。

| 路由（含全局前缀 `api/v1`，见 `services/api/src/main.ts:13`） | 声明处 | 取键点 |
|---|---|---|
| `GET /admin/ai-runtime/assistants` | `platform-registry.controller.ts:72` | 无需幂等键 |
| `POST /admin/ai-runtime/assistants` | `:78` | `:85` `requireAdminAiIdempotencyKey(key)` |
| `PATCH /admin/ai-runtime/assistants/:assistantId` | `:99` | `:107` 同上 |
| `GET /admin/ai-runtime/teams` | `:122` | 无需幂等键 |
| `POST /admin/ai-runtime/teams` | `:128` | `:135` 同上 |
| `PATCH /admin/ai-runtime/teams/:teamId` | `:149` | `:157` 同上 |

取键函数 `requireAdminAiIdempotencyKey`（`platform-registry.controller.ts:173-177`）：只读
`@Headers('idempotency-key')`，`trim` 后非空且 ≤ 160，否则 400 `IDEMPOTENCY_KEY_REQUIRED`；
完全不看 body。

同类 header-only 的其他写端点（函数定义 `team-runtime.controller.ts:254`）：
`POST /admin/ai-runtime/routes`（`:37`，取键 `:44`）、`PATCH /admin/ai-runtime/routes/:routeId`
（`:58`，`:66`）、`POST /tutor/team-runs/:runId/phase`（`:117`，`:125`）、
`POST /admin/agent-runs/:runId/gates`（`:140`，`:148`）；以及
`PATCH` / `POST /admin/ai-runtime/agents/:agentId`（`platform-registry.controller.ts:28` / `:49`，
内联校验 `:36` / `:57`）——同样只认头。

**既有例外两条（body 优先、header 兜底）**：

| 端点 | 声明 | 取键点 |
|---|---|---|
| `POST /api/v1/tutor/team-runs` | `team-runtime.controller.ts:80` | `:188` `typeof value.idempotencyKey === 'string' ? value.idempotencyKey : headerKey` |
| `POST /api/v1/admin/agent-runs/:runId/delegate` | `:163` | `:208` 同一写法 |

原因（只陈述事实）：既有客户端就是这么传的——
`apps/student-center/features/tutor/data/tutorStream.ts:38` 将 `idempotencyKey` 定义在请求体
`TutorStreamRequest` 里并在 `:102` `body: JSON.stringify(request)` 发送（请求头只有
content-type / accept）；`apps/admin-console/lib/api/agentTeam.ts:122` 也在 body 里带
`idempotencyKey`。服务端流式入口 `POST /tutor/sessions/:id/stream` 同样是头优先、
body 兜底（`ai-tutor/tutor.controller.ts:176-180`）。

⚠️ **已知不一致**：同一平台内两种取键方式并存。统一成纯 header 需要同时修改
student-center 流式链路与 admin-console 团队入口，属于跨平台破坏性变更，需单独立项；
**本期不改行为，只如实记录**。

## 学生端消费的团队帧

5 个 `team.*` 帧已全部被学生端消费（不再静默丢弃）。常量单一出处：
`apps/student-center/features/tutor/data/teamFrames.ts` ——
帧名 `TUTOR_TEAM_FRAME_NAMES`（`:23-29`）、`teamFrameKind`（`:39`）、
`TUTOR_TEAM_FRAME_NAME_LIST`（`:44`）、`teamFrameToReplyBlock`（`:138`）。
解析器 `tutorStream.ts:60-73` 把 `TUTOR_TEAM_FRAME_NAME_LIST` 展开进 `KNOWN_FRAMES`（`:72`），
在 `:222` / `:226` 将帧转为回复块；字段缺失/非法时返回 null（格式校验失败丢弃坏帧，
不是吞帧，也不用默认阶段假装渲染）。

| 帧名 | 学生端呈现 | 出处 |
|---|---|---|
| `team.phase_advanced` | `pbl_card` 阶段卡（含阶段进度 `n/4`、上一门禁已由服务端确认达成） | `teamFrames.ts:144` |
| `team.gate_blocked` | `pbl_card` 门禁拒绝 + 中文提示 | `:162`（文案表 `ERROR_CODE_MESSAGES:78`、`GATE_LABELS:70`） |
| `team.member_delegated` | `tool` 委派时间线条目（收件助手 / 任务类型 / 状态三态） | `:185` |
| `team.tool_invoked` | `tool` 工具调用时间线条目 | `:201` |
| `team.thinking` | `think` 团队思考块（只呈现阶段标签，不含思考原文） | `:216` |

**服务端真实写入点（逐项核实）**：

- `team.phase_advanced`：有写入点——`advancePhase` 成功后的 `recordEvent`
  （`team-runtime.service.ts:884-894`，主题常量 `:61`）。
- `team.gate_blocked`：有写入点——两处：delegate 被门禁拒（`:632-637`）与
  advancePhase 被拒（`:853-864`）；主题常量 `:59`。
- `team.member_delegated`：有产出点——不是事件，而是由 `agent_team_tasks` 行直接
  合成帧（`listSessionStreamFrames` 内 `:964-980`）。
- `team.tool_invoked` / `team.thinking`：**目前只有帧名与事件主题声明，无写入点**。
  声明见 `TEAM_FRAME_NAMES`（`team-runtime.service.ts:68-74`）、主题常量
  `TEAM_TOOL_INVOKED_TOPIC:63` / `TEAM_MODEL_THINKING_TOPIC:65`、事件→帧映射 `:85-90`；
  但 `services/api/src` 内不存在任何 `recordEvent` 以这两个主题写入的调用（已逐个
  grep 确认，仅 protocol / gate 测试自行造事件）。学生端已按容错字段解析就绪，
  服务端一旦开始写入即可直接渲染；在那之前这两类帧不会出现在流上。

输出链路与脱敏（未成年人数据最小化）：

- 帧来源 `listSessionStreamFrames`（`team-runtime.service.ts:913-983`），按
  `TEAM_TOPIC_FRAME_KIND` 过滤事件，最多 50 帧并按时间排序（`:981-982`）。
- SSE 出口 `services/api/src/modules/ai-tutor/tutor.controller.ts:233-250`，每帧经
  `writeTeamFrame`（`:417-428`）输出，帧名取 `teamFrameName`（`team-runtime.service.ts:118`）。
  Team Runtime 故障不能把正常学生对话流变成错误流（`:251-253` 只 swallow，不注入 error）。
- 载荷经 `buildTeamFrameData`（`:144-146`）→ `sanitizeTeamFramePayload`（`:128-141`）：
  剥离 `RAW_TEXT_KEYS` 里的原文类字段（`:101-115`）、字符串截断 120 字符（`:116`）、
  字符串数组最多 10 项。对话原文不上流。
- 新增/改名帧类型必须同步 `team-runtime.protocol.test.ts` 的断言与前端
  `teamFrames.ts` 两处（前端注释已约束）。
