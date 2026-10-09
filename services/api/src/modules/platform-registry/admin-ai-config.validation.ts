import { BadRequestException } from '@nestjs/common';
import type {
  AdminAssistantCreateInput,
  AdminAssistantUpdateInput,
  AdminTeamCreateInput,
  AdminTeamMemberInput,
  AdminTeamPblPhaseInput,
  AdminTeamPblSpecInput,
  AdminTeamUpdateInput,
  AssistantDefaults,
  PblGateCondition,
  PblPhase,
  TeamSessionMode,
  TeammateRole,
  WorkspaceMode,
} from '@qitu/contracts';

/**
 * 管理端「助手 / 团队」写入载荷的强校验（T1 冻结契约的服务端闸门）。
 *
 * 原则：
 * - 白名单字段：`id` / `source` / `deletable` / `agentStatus` / `createdAt` /
 *   `updatedAt` / 成员的 `assistantName` / `avatar` / `status` 一律拒绝，
 *   这些只能由服务端补全（冻结规则 1/3）。
 * - PBL 门禁只可加强、不可削弱：`theoryMasteredGate` 必须是字面量 `true`
 *   （写成 `false` 或**省略**都拒绝）；`allowAutonomousAdvance` 只接受 `false` 或省略；
 *   `concept_mastery` 阶段显式提交的门禁必须是 `TheoryMastered`（冻结规则 4）。
 * - 空 PATCH 拒绝；`members.length >= 1`；同一补丁内同时提交
 *   `leaderAssistantId` 与 `members` 时，leader 必须命中成员。
 * - 错误码稳定：`ADMIN_AI_CONFIG_INVALID`（缺幂等键的 400 由控制器给出
 *   `IDEMPOTENCY_KEY_REQUIRED`，两者不混用）。
 */

function invalid(reason: string): never {
  throw new BadRequestException({ code: 'ADMIN_AI_CONFIG_INVALID', message: `助手/团队配置无效：${reason}` });
}

const ROLES: readonly TeammateRole[] = ['leader', 'teammate', 'reviewer', 'coach'];
const WORKSPACE_MODES: readonly WorkspaceMode[] = ['shared', 'isolated'];
const SESSION_MODES: readonly TeamSessionMode[] = ['auto', 'plan', 'supervised'];
const PBL_PHASES: readonly PblPhase[] = ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'];
const GATE_CONDITIONS: readonly PblGateCondition[] = [
  'student_confirmed_intent',
  'TheoryMastered',
  'code_playable_run_verified',
  'review_completed_and_archived',
];

/** 阶段缺省门禁（服务端补全；concept_mastery 恒为 TheoryMastered）。 */
export const PBL_PHASE_GATE_DEFAULTS: Record<PblPhase, PblGateCondition> = {
  exploration: 'student_confirmed_intent',
  concept_mastery: 'TheoryMastered',
  guided_practice: 'code_playable_run_verified',
  deliverable_review: 'review_completed_and_archived',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownKeys(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) invalid(`${label}包含不可写字段 "${key}"`);
  }
}

function trimmedText(value: unknown, field: string, max: number, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) invalid(`缺少必填字段 ${field}`);
    return undefined;
  }
  if (typeof value !== 'string') invalid(`${field} 必须是字符串`);
  const out = (value as string).trim();
  if (required && !out) invalid(`${field} 不能为空`);
  if (out.length > max) invalid(`${field} 超过 ${max} 个字符`);
  return out;
}

/** 展示名：裁剪空白后 1–40 字符（硬要求 3）。 */
function displayName(value: unknown, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) invalid('缺少必填字段 name');
    return undefined;
  }
  if (typeof value !== 'string') invalid('name 必须是字符串');
  const out = (value as string).trim();
  if (out.length < 1 || out.length > 40) invalid('name 裁剪空白后须为 1–40 个字符');
  return out;
}

function booleanField(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(`${field} 必须是布尔值`);
  return value as boolean;
}

function nullableId(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = trimmedText(value, field, 160, true);
  return text === undefined ? undefined : text;
}

function integerField(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(`${field} 须为 ${min}–${max} 的整数`);
  }
  return value as number;
}

/** 采样温度：0–2（硬要求 3）。 */
function temperatureField(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 2) {
    invalid('temperature 须在 0–2 之间');
  }
  return value as number;
}

function stringList(value: unknown, field: string, max: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) invalid(`${field} 必须是长度不超过 ${max} 的字符串数组`);
  const list = value as unknown[];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim() || item.length > 160) invalid(`${field} 含无效字符串项`);
    out.push((item as string).trim());
  }
  if (new Set(out).size !== out.length) invalid(`${field} 含重复项`);
  return out;
}

function parseDefaults(value: unknown): Partial<AssistantDefaults> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) invalid('defaults 必须是对象');
  assertKnownKeys(value, ['model', 'permission', 'thought_level', 'skills', 'mcps'], 'defaults ');
  const out: Partial<AssistantDefaults> = {};
  for (const key of ['model', 'permission', 'thought_level'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (!isPlainObject(raw)) invalid(`defaults.${key} 必须是 { mode, value? } 对象`);
    assertKnownKeys(raw, ['mode', 'value'], `defaults.${key} `);
    const mode = trimmedText(raw.mode, `defaults.${key}.mode`, 60, true)!;
    const itemValue = raw.value === undefined ? undefined : trimmedText(raw.value, `defaults.${key}.value`, 240, false);
    out[key] = itemValue === undefined ? { mode } : { mode, value: itemValue };
  }
  for (const key of ['skills', 'mcps'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (!isPlainObject(raw)) invalid(`defaults.${key} 必须是 { mode, value[] } 对象`);
    assertKnownKeys(raw, ['mode', 'value'], `defaults.${key} `);
    const mode = trimmedText(raw.mode, `defaults.${key}.mode`, 60, true)!;
    const items = stringList(raw.value === undefined ? [] : raw.value, `defaults.${key}.value`, 64) ?? [];
    out[key] = { mode, value: items };
  }
  return out;
}

const ASSISTANT_KEYS = [
  'name', 'description', 'role', 'instructions', 'avatar', 'modelProviderId', 'modelId',
  'temperature', 'enabledSkills', 'toolIds', 'mcpServerIds', 'defaults', 'teamSelectable',
  'sortOrder', 'enabled',
] as const;

function parseAssistantBody(body: unknown, partial: boolean): AdminAssistantUpdateInput & Partial<AdminAssistantCreateInput> {
  if (!isPlainObject(body)) invalid('请求体必须是 JSON 对象');
  assertKnownKeys(body, ASSISTANT_KEYS, '助手配置');
  if (partial && Object.keys(body).length === 0) invalid('PATCH 不能为空补丁');
  const out: AdminAssistantUpdateInput & Partial<AdminAssistantCreateInput> = {};
  if ('name' in body || !partial) out.name = displayName(body.name, !partial)!;
  if ('description' in body || !partial) out.description = trimmedText(body.description, 'description', 500, !partial)!;
  if ('role' in body || !partial) out.role = trimmedText(body.role, 'role', 160, !partial)!;
  if ('instructions' in body || !partial) out.instructions = trimmedText(body.instructions, 'instructions', 20000, !partial)!;
  if ('avatar' in body) {
    const avatar = trimmedText(body.avatar, 'avatar', 32, false);
    if (avatar !== undefined) out.avatar = avatar;
  }
  if ('modelProviderId' in body) out.modelProviderId = nullableId(body.modelProviderId, 'modelProviderId');
  if ('modelId' in body) out.modelId = nullableId(body.modelId, 'modelId');
  if ('temperature' in body) out.temperature = temperatureField(body.temperature);
  if ('enabledSkills' in body) out.enabledSkills = stringList(body.enabledSkills, 'enabledSkills', 64);
  if ('toolIds' in body) out.toolIds = stringList(body.toolIds, 'toolIds', 64);
  if ('mcpServerIds' in body) out.mcpServerIds = stringList(body.mcpServerIds, 'mcpServerIds', 32);
  if ('defaults' in body) out.defaults = parseDefaults(body.defaults);
  if ('teamSelectable' in body) out.teamSelectable = booleanField(body.teamSelectable, 'teamSelectable');
  if ('sortOrder' in body) out.sortOrder = integerField(body.sortOrder, 'sortOrder', 0, 100000);
  if ('enabled' in body) out.enabled = booleanField(body.enabled, 'enabled');
  return out;
}

export function parseAssistantCreate(body: unknown): AdminAssistantCreateInput {
  return parseAssistantBody(body, false) as AdminAssistantCreateInput;
}

export function parseAssistantUpdate(body: unknown): AdminAssistantUpdateInput {
  return parseAssistantBody(body, true) as AdminAssistantUpdateInput;
}

const MEMBER_KEYS = ['slotId', 'assistantId', 'role', 'roleLabel', 'model', 'color', 'pblPhase'] as const;

function parseMembers(value: unknown): AdminTeamMemberInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    invalid('members 必须是 1–32 个成员的数组');
  }
  const members = (value as unknown[]).map((item): AdminTeamMemberInput => {
    if (!isPlainObject(item)) invalid('members 每一项必须是对象');
    assertKnownKeys(item, MEMBER_KEYS, '团队成员');
    const assistantId = trimmedText(item.assistantId, 'members[].assistantId', 160, true)!;
    const role = trimmedText(item.role, 'members[].role', 40, true)!;
    if (!ROLES.includes(role as TeammateRole)) invalid(`members[].role 无效：${role}`);
    const member: AdminTeamMemberInput = { assistantId, role: role as TeammateRole };
    if (item.slotId !== undefined) {
      const slotId = trimmedText(item.slotId, 'members[].slotId', 160, true)!;
      member.slotId = slotId;
    }
    const roleLabel = trimmedText(item.roleLabel, 'members[].roleLabel', 160, false);
    if (roleLabel !== undefined) member.roleLabel = roleLabel;
    const model = trimmedText(item.model, 'members[].model', 160, false);
    if (model !== undefined) member.model = model;
    const color = trimmedText(item.color, 'members[].color', 64, false);
    if (color !== undefined) member.color = color;
    if (item.pblPhase !== undefined) {
      const phase = trimmedText(item.pblPhase, 'members[].pblPhase', 40, true)!;
      if (!PBL_PHASES.includes(phase as PblPhase)) invalid(`members[].pblPhase 无效：${phase}`);
      member.pblPhase = phase as PblPhase;
    }
    return member;
  });
  const slotIds = members.map((m) => m.slotId).filter((s): s is string => s !== undefined);
  if (new Set(slotIds).size !== slotIds.length) invalid('members[].slotId 不能重复');
  return members;
}

const PBL_SPEC_KEYS = ['projectId', 'projectName', 'targetDomain', 'phases', 'theoryMasteredGate', 'allowAutonomousAdvance'] as const;
const PBL_PHASE_KEYS = ['phase', 'title', 'assignedAssistantId', 'assignedRoleLabel', 'learningObjectives', 'gateCondition', 'deliverableType'] as const;

function parsePblSpec(value: unknown): AdminTeamPblSpecInput {
  if (!isPlainObject(value)) invalid('pblSpec 必须是对象');
  assertKnownKeys(value, PBL_SPEC_KEYS, 'PBL 工作流');
  // 硬门禁（冻结规则 4）：必须显式提交字面量 true；写 false 或缺失一律拒绝。
  if (!('theoryMasteredGate' in value) || value.theoryMasteredGate !== true) {
    invalid('pblSpec.theoryMasteredGate 必须为 true（TheoryMastered 之前不得进入实践阶段，门禁不可削弱）');
  }
  if ('allowAutonomousAdvance' in value && value.allowAutonomousAdvance !== false) {
    invalid('pblSpec.allowAutonomousAdvance 当前只允许 false 或省略');
  }
  if (!Array.isArray(value.phases) || value.phases.length < 1 || value.phases.length > 8) {
    invalid('pblSpec.phases 必须是 1–8 个阶段的数组');
  }
  const phases = (value.phases as unknown[]).map((item): AdminTeamPblPhaseInput => {
    if (!isPlainObject(item)) invalid('pblSpec.phases 每一项必须是对象');
    assertKnownKeys(item, PBL_PHASE_KEYS, 'PBL 阶段');
    const phase = trimmedText(item.phase, 'phases[].phase', 40, true)!;
    if (!PBL_PHASES.includes(phase as PblPhase)) invalid(`phases[].phase 无效：${phase}`);
    const assignedAssistantId = trimmedText(item.assignedAssistantId, 'phases[].assignedAssistantId', 160, true)!;
    const title = trimmedText(item.title, 'phases[].title', 200, true)!;
    const spec: AdminTeamPblPhaseInput = { phase: phase as PblPhase, title, assignedAssistantId };
    if ('gateCondition' in item && item.gateCondition !== undefined) {
      const gate = trimmedText(item.gateCondition, 'phases[].gateCondition', 60, true)!;
      if (!GATE_CONDITIONS.includes(gate as PblGateCondition)) invalid(`phases[].gateCondition 无效：${gate}`);
      // concept_mastery 的门禁只认 TheoryMastered，显式提交其他值直接拒绝（硬要求 4）。
      if (phase === 'concept_mastery' && gate !== 'TheoryMastered') {
        invalid('concept_mastery 阶段的 gateCondition 必须是 TheoryMastered');
      }
      spec.gateCondition = gate as PblGateCondition;
    }
    const roleLabel = trimmedText(item.assignedRoleLabel, 'phases[].assignedRoleLabel', 160, false);
    if (roleLabel !== undefined) spec.assignedRoleLabel = roleLabel;
    const objectives = stringList(item.learningObjectives, 'phases[].learningObjectives', 32);
    if (objectives !== undefined) spec.learningObjectives = objectives;
    const deliverable = trimmedText(item.deliverableType, 'phases[].deliverableType', 120, false);
    if (deliverable !== undefined) spec.deliverableType = deliverable;
    return spec;
  });
  return {
    projectId: trimmedText(value.projectId, 'pblSpec.projectId', 160, true)!,
    projectName: trimmedText(value.projectName, 'pblSpec.projectName', 200, true)!,
    targetDomain: trimmedText(value.targetDomain, 'pblSpec.targetDomain', 120, true)!,
    phases,
    theoryMasteredGate: true,
    ...( 'allowAutonomousAdvance' in value ? { allowAutonomousAdvance: false as const } : {} ),
  };
}

const TEAM_KEYS = [
  'name', 'description', 'leaderAssistantId', 'members', 'workspaceMode', 'sessionMode',
  'concurrencyLimit', 'pblSpec', 'enabled',
] as const;

function parseTeamBody(body: unknown, partial: boolean): AdminTeamUpdateInput & Partial<AdminTeamCreateInput> {
  if (!isPlainObject(body)) invalid('请求体必须是 JSON 对象');
  assertKnownKeys(body, TEAM_KEYS, '团队配置');
  if (partial && Object.keys(body).length === 0) invalid('PATCH 不能为空补丁');
  const out: AdminTeamUpdateInput & Partial<AdminTeamCreateInput> = {};
  if ('name' in body || !partial) out.name = displayName(body.name, !partial)!;
  if ('description' in body || !partial) out.description = trimmedText(body.description, 'description', 2000, !partial)!;
  if ('leaderAssistantId' in body || !partial) {
    out.leaderAssistantId = trimmedText(body.leaderAssistantId, 'leaderAssistantId', 160, !partial)!;
  }
  if ('members' in body || !partial) out.members = parseMembers(body.members);
  if ('workspaceMode' in body) {
    const mode = trimmedText(body.workspaceMode, 'workspaceMode', 40, true)!;
    if (!WORKSPACE_MODES.includes(mode as WorkspaceMode)) invalid(`workspaceMode 无效：${mode}`);
    out.workspaceMode = mode as WorkspaceMode;
  }
  if ('sessionMode' in body) {
    const mode = trimmedText(body.sessionMode, 'sessionMode', 40, true)!;
    if (!SESSION_MODES.includes(mode as TeamSessionMode)) invalid(`sessionMode 无效：${mode}`);
    out.sessionMode = mode as TeamSessionMode;
  }
  if ('concurrencyLimit' in body) out.concurrencyLimit = integerField(body.concurrencyLimit, 'concurrencyLimit', 1, 8);
  if ('pblSpec' in body) out.pblSpec = parsePblSpec(body.pblSpec);
  if ('enabled' in body) out.enabled = booleanField(body.enabled, 'enabled');
  // 同一补丁内同时提交 leader 与 members 时，leader 必须命中某个成员（硬要求 3）。
  if (out.leaderAssistantId !== undefined && out.members !== undefined) {
    if (!out.members.some((member) => member.assistantId === out.leaderAssistantId)) {
      invalid('leaderAssistantId 必须是 members 中的某个助手');
    }
  }
  return out;
}

export function parseTeamCreate(body: unknown): AdminTeamCreateInput {
  return parseTeamBody(body, false) as AdminTeamCreateInput;
}

export function parseTeamUpdate(body: unknown): AdminTeamUpdateInput {
  return parseTeamBody(body, true) as AdminTeamUpdateInput;
}
