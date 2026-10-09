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

幂等键**一律**通过 HTTP 头 `Idempotency-Key` 传递，**不放进 body**；body 中出现
`idempotencyKey` 属于未知字段，必须被拒绝。

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
