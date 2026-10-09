import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAssistants, adminTeamMembers, adminTeams, agentConfigs, runtimeMcpServers, tutorPartners, type Database } from '@qitu/database';
import { PlatformRegistryService } from './platform-registry.service';
import { PlatformRegistryController } from './platform-registry.controller';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyResult, IdempotentHandler } from '../../common/idempotency/idempotency.types';
import { parseAssistantCreate, parseTeamCreate } from './admin-ai-config.validation';

function fakeDatabase() {
  const partner = {
    id: 'tutor-default', displayName: 'Tutor', soul: 'private prompt body', modelUsage: 'tutor.chat',
    promptVersion: 'v3', capabilities: ['explore', 'teach'], enabled: true,
    roleDefinition: '教学伙伴定义，使用问题支持学生理解与反思。',
  };
  const chain = {
    where() { return this; },
    orderBy() { return this; },
    limit: async () => [],
  };
  return {
    execute: async () => ({ rows: [{ '?column?': 1 }] }),
    select: () => ({
      from(table: unknown) {
        if (table === tutorPartners) return Promise.resolve([partner]);
        if (table === agentConfigs || table === runtimeMcpServers) return Promise.resolve([]);
        return chain;
      },
    }),
  } as unknown as Database;
}

test('runtime projection uses persisted partner metadata and excludes prompt contents', async () => {
  const service = new PlatformRegistryService(
    fakeDatabase(),
    'live',
    { write: async () => 'audit-id' } as never,
    { getUsages: () => ({ usages: [], bindings: [] }) } as never,
  );
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.dataSource, 'live');
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0]?.promptVersion, 'v3');
  assert.deepEqual(snapshot.agents[0]?.capabilities, ['explore', 'teach']);
  assert.equal(snapshot.agents[0]?.roleDefinition, '教学伙伴定义，使用问题支持学生理解与反思。');
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('private prompt body'), false);
  assert.equal(snapshot.policy.id, 'AGENTS.md');
  assert.equal(snapshot.policy.status, 'ready');
  assert.equal(snapshot.skills.some((skill) => skill.id === 'student-module'), false);
  assert.equal(snapshot.agents.some((agent) => agent.id === 'admin'), false);
  assert.deepEqual(snapshot.builtInTools[0]?.agentIds, ['qitu-learning-partner']);
  assert.deepEqual(snapshot.mcpServers, []);
});

/* ==================== admin 助手 / 团队 CRUD（T2） ==================== */

const ADMIN_COOKIE = 'qitu_session=admin-token';

/** 只验证角色闸门与幂等接线：不会真的读会话存储。 */
function fakeAuth(role: 'admin' | 'student') {
  return {
    getSession: () => ({ user: { id: `user-${role}`, role } }),
  } as never;
}

/**
 * 内存版 IdempotencyStore：同 (scope,key) 同 hash 重放首次结果且**不再执行
 * handler**；同 key 不同 hash 抛 IDEMPOTENCY_CONFLICT。语义与持久化实现一致，
 * 用于验证控制器接线（真幂等、不重复落库、不重复审计）。
 */
class RecordingIdempotencyStore extends IdempotencyStore {
  readonly executions: Array<{ scope: string; key: string }> = [];
  private readonly records = new Map<string, { hash: string; status: number; body: unknown }>();

  async execute<T>(scope: string, key: string, requestHash: string, handler: IdempotentHandler<T>): Promise<IdempotencyResult<T>> {
    const id = `${scope}|${key}`;
    const existing = this.records.get(id);
    if (existing) {
      if (existing.hash !== requestHash) throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '同 key 不同载荷');
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions.push({ scope, key });
    const outcome = await handler();
    const status = outcome.status ?? 200;
    this.records.set(id, { hash: requestHash, status, body: outcome.body });
    return { status, body: outcome.body, replayed: false };
  }
}

type Row = Record<string, unknown>;

function assistantRow(overrides: Row = {}): Row {
  return {
    id: 'tutor-leader', source: 'builtin', name: '启途总导师', avatar: '👨‍🏫',
    description: '总导师', role: 'Team Leader / 总导师', enabled: true, sortOrder: 1,
    modelProviderId: 'bailian', modelId: 'qwen3.8-flash', temperature: 0.7,
    instructions: '启发式引导。', enabledSkills: [], toolIds: [], mcpServerIds: [],
    defaults: {}, agentStatus: 'online', agentStatusMessage: null, teamSelectable: true,
    updatedBy: null, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-09T00:00:00Z'),
    ...overrides,
  };
}

function teamRow(overrides: Row = {}): Row {
  return {
    id: 'team-1', name: '雷霆战机 PBL 导师团队', description: '协同导师团队',
    workspaceMode: 'shared', sessionMode: 'supervised', leaderAssistantId: 'tutor-leader',
    concurrencyLimit: 2, pblSpec: null, enabled: true, updatedBy: null,
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-09T00:00:00Z'),
    ...overrides,
  };
}

function memberRow(overrides: Row = {}): Row {
  return {
    slotId: 'slot-leader', teamId: 'team-1', assistantId: 'tutor-leader', role: 'leader',
    roleLabel: null, model: null, color: null, pblPhase: 'exploration', status: 'active',
    sortOrder: 0, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-09T00:00:00Z'),
    ...overrides,
  };
}

/** 配置表体量小：服务层只发全表 select / insert / update / delete，假库按表名预置行即可。 */
function fakeConfigDb(state: { assistants: Row[]; teams: Row[]; members: Row[] }) {
  const ops = { inserts: [] as Array<{ table: unknown; values: unknown }>, updates: [] as Array<{ table: unknown; set: Row }>, deletes: [] as unknown[] };
  const rowsFor = (table: unknown): Row[] => {
    if (table === adminAssistants) return state.assistants;
    if (table === adminTeams) return state.teams;
    if (table === adminTeamMembers) return state.members;
    return [];
  };
  class Chain {
    constructor(private readonly rows: Row[]) {}
    where() { return this; }
    orderBy() { return this; }
    limit() { return this; }
    then(resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve(this.rows).then(resolve, reject);
    }
  }
  const executor = {
    select: () => ({ from: (table: unknown) => new Chain(rowsFor(table)) }),
    insert: (table: unknown) => ({ values: (values: unknown) => { ops.inserts.push({ table, values }); return Promise.resolve(); } }),
    update: (table: unknown) => ({
      set: (patch: Row) => ({ where: () => { ops.updates.push({ table, set: patch }); return Promise.resolve(); } }),
    }),
    delete: (table: unknown) => ({ where: () => { ops.deletes.push(table); return Promise.resolve(); } }),
  };
  const db = { ...executor, transaction: async (fn: (tx: typeof executor) => unknown) => fn(executor) };
  return { db: db as unknown as Database, ops };
}

function harness(state?: { assistants: Row[]; teams: Row[]; members: Row[] }) {
  const store = { calls: [] as Array<{ entry: Row }> };
  const audit = { write: async (entry: Row) => { store.calls.push({ entry }); return `audit-${store.calls.length}`; } };
  const models = {
    getUsages: () => ({ usages: [], bindings: [] }),
    listAgentModelOptions: () => [],
  };
  const fake = fakeConfigDb(state ?? { assistants: [], teams: [], members: [] });
  const service = new PlatformRegistryService(fake.db, 'live', audit as never, models as never);
  const idempotency = new RecordingIdempotencyStore();
  return { service, idempotency, audits: store.calls, ...fake };
}

test('POST assistants：缺少 Idempotency-Key → 400 稳定错误码，且不落库、不审计', async () => {
  const h = harness();
  const controller = new PlatformRegistryController(fakeAuth('admin'), h.service, h.idempotency);
  const body = { name: '新助手', description: 'd', role: 'r', instructions: 'i' };
  await assert.rejects(
    () => controller.createAssistant(ADMIN_COOKIE, undefined, body),
    (error: unknown) => {
      const e = error as { getStatus: () => number; getResponse: () => { code: string } };
      assert.equal(e.getStatus(), 400);
      assert.equal(e.getResponse().code, 'IDEMPOTENCY_KEY_REQUIRED');
      return true;
    },
  );
  assert.equal(h.ops.inserts.length, 0, '缺幂等键时绝不能写入数据库');
  assert.equal(h.audits.length, 0, '缺幂等键时绝不能写审计');
});

test('POST assistants：同 key 重放返回首次结果，不重复落库、不重复审计', async () => {
  const h = harness();
  const controller = new PlatformRegistryController(fakeAuth('admin'), h.service, h.idempotency);
  const body = { name: '新助手', description: 'd', role: 'r', instructions: 'i' };
  const first = await controller.createAssistant(ADMIN_COOKIE, 'key-1', body);
  const replay = await controller.createAssistant(ADMIN_COOKIE, 'key-1', body);
  assert.deepEqual(replay, first);
  assert.equal(h.ops.inserts.length, 1, '重放绝不能第二次 insert');
  assert.equal(h.audits.length, 1, '重放绝不能写第二条审计');
  assert.equal(h.idempotency.executions.length, 1, 'handler 只能被执行一次');
  assert.deepEqual(first.data.source, 'user');
  assert.equal(first.data.deletable, true, '用户创建的助手 deletable 由服务端派生为 true');
  assert.equal(first.data.agentStatus, 'unchecked', 'agentStatus 由服务端补全');
});

test('PATCH 幂等作用域拼资源 id：同 key 不同助手不能互相重放', async () => {
  const h = harness({
    assistants: [assistantRow({ id: 'a1' }), assistantRow({ id: 'a2' })],
    teams: [], members: [],
  });
  const controller = new PlatformRegistryController(fakeAuth('admin'), h.service, h.idempotency);
  await controller.updateAssistant(ADMIN_COOKIE, 'shared-key', 'a1', { enabled: false });
  await controller.updateAssistant(ADMIN_COOKIE, 'shared-key', 'a2', { enabled: false });
  assert.equal(h.idempotency.executions.length, 2, '更新作用域必须含 :${id}，否则第二个助手会被误重放');
  assert.equal(h.audits.length, 2);
});

test('非 admin 角色访问写接口 → 403，不得执行幂等 handler、不得写成功审计', async () => {
  const h = harness();
  const controller = new PlatformRegistryController(fakeAuth('student'), h.service, h.idempotency);
  const body = teamCreateBody();
  await assert.rejects(
    () => controller.createTeam(ADMIN_COOKIE, 'key-team', body),
    (error: unknown) => {
      assert.equal((error as { getStatus: () => number }).getStatus(), 403);
      return true;
    },
  );
  assert.equal(h.idempotency.executions.length, 0);
  assert.equal(h.audits.length, 0, '403 绝不允许留下成功审计');
  assert.equal(h.ops.inserts.length, 0);
  await assert.rejects(() => controller.listAssistants(ADMIN_COOKIE), (error: unknown) =>
    (error as { getStatus: () => number }).getStatus() === 403);
});

test('theoryMasteredGate=false 在触碰数据库前被拒绝；true 时落库载荷由服务端写死门禁', async () => {
  const h = harness({ assistants: [assistantRow(), assistantRow({ id: 'coach', source: 'user', role: 'Coach / 概念教练', name: '教练', sortOrder: 2 })], teams: [], members: [] });
  const controller = new PlatformRegistryController(fakeAuth('admin'), h.service, h.idempotency);
  const weakened = teamCreateBody();
  (weakened.pblSpec as Row).theoryMasteredGate = false;
  await assert.rejects(
    () => controller.createTeam(ADMIN_COOKIE, 'key-gate', weakened),
    (error: unknown) => {
      const e = error as { getStatus: () => number; getResponse: () => { code: string } };
      assert.equal(e.getStatus(), 400);
      assert.equal(e.getResponse().code, 'ADMIN_AI_CONFIG_INVALID');
      return true;
    },
  );
  assert.equal(h.ops.inserts.length, 0, '门禁削弱请求绝不能落库');
  assert.equal(h.audits.length, 0);
  const created = await controller.createTeam(ADMIN_COOKIE, 'key-ok', teamCreateBody());
  assert.equal(created.data.pblSpec?.theoryMasteredGate, true);
  assert.equal(created.data.pblSpec?.allowAutonomousAdvance, false);
  const practice = created.data.pblSpec?.phases.find((phase) => phase.phase === 'guided_practice');
  const mastery = created.data.pblSpec?.phases.find((phase) => phase.phase === 'concept_mastery');
  assert.equal(mastery?.gateCondition, 'TheoryMastered', 'concept_mastery 缺省门禁由服务端补为 TheoryMastered');
  assert.equal(practice?.gateCondition, 'code_playable_run_verified');
});

test('团队成员校验：leaderAssistantId 不在 members → 拒绝；助手不存在/不可选/未启用 → 拒绝', async () => {
  const h = harness({ assistants: [assistantRow(), assistantRow({ id: 'ghost', teamSelectable: false }), assistantRow({ id: 'off', enabled: false })], teams: [], members: [] });
  await assert.rejects(
    async () => h.service.createTeam(actor(), parseTeamCreate(teamCreateBody({ leaderAssistantId: 'not-a-member' }))),
    (error: unknown) => (error as { getStatus: () => number }).getStatus() === 400,
  );
  await assert.rejects(
    async () => h.service.createTeam(actor(), parseTeamCreate(teamCreateBody({
      members: [{ assistantId: 'nope', role: 'leader' }], leaderAssistantId: 'nope',
    }))),
    (error: unknown) => (error as { getStatus: () => number }).getStatus() === 400,
    '助手不存在应拒绝',
  );
  await assert.rejects(
    async () => h.service.createTeam(actor(), parseTeamCreate(teamCreateBody({
      members: [{ assistantId: 'ghost', role: 'leader' }], leaderAssistantId: 'ghost',
    }))),
    (error: unknown) => (error as { getStatus: () => number }).getStatus() === 400,
    'teamSelectable=false 的助手不可入队',
  );
  await assert.rejects(
    async () => h.service.createTeam(actor(), parseTeamCreate(teamCreateBody({
      members: [{ assistantId: 'off', role: 'leader' }], leaderAssistantId: 'off',
    }))),
    (error: unknown) => (error as { getStatus: () => number }).getStatus() === 400,
    'enabled=false 的助手不可入队',
  );
  assert.equal(h.ops.inserts.length, 0, '被拒绝的团队创建不得产生任何写入');
});

test('GET teams：成员的 assistantName/avatar/status 由服务端解析回填，内置助手 deletable=false', async () => {
  const h = harness({
    assistants: [assistantRow()],
    teams: [teamRow({ pblSpec: { projectId: 'p', projectName: 'n', targetDomain: 'd', phases: [], theoryMasteredGate: true, allowAutonomousAdvance: false } })],
    members: [memberRow()],
  });
  const teams = await h.service.listTeams();
  assert.equal(teams.length, 1);
  const member = teams[0]!.members[0]!;
  assert.equal(member.assistantName, '启途总导师', '成员名称由助手表解析');
  assert.equal(member.avatar, '👨‍🏫', '头像由助手表解析');
  assert.equal(member.roleLabel, 'Team Leader / 总导师', 'roleLabel 缺省回退到助手 role');
  assert.equal(member.model, 'qwen3.8-flash', 'model 缺省回退到助手 modelId');
  assert.equal(member.status, 'active', 'status 为服务端持有的运行态列');
  const assistants = await h.service.listAssistants();
  assert.equal(assistants[0]!.deletable, false, '内置助手 source=builtin → deletable 恒为 false');
});

test('createAssistant：服务端补全排序追加、派生字段进 insert，审计不落提示词正文', async () => {
  const h = harness({ assistants: [assistantRow({ sortOrder: 5 })], teams: [], members: [] });
  const created = await h.service.createAssistant(actor(), parseAssistantCreate({
    name: '新助手', description: 'd', role: 'r', instructions: '私密提示词不应进审计',
  }));
  assert.equal(created.sortOrder, 6, 'sortOrder 缺省追加到列表末尾');
  assert.equal(created.source, 'user');
  assert.equal(created.agentStatus, 'unchecked');
  const insert = h.ops.inserts.find((op) => op.table === adminAssistants);
  const values = insert?.values as Row;
  assert.equal(values.source, 'user');
  assert.equal(values.agentStatus, 'unchecked');
  assert.ok(values.id);
  assert.ok(values.createdAt instanceof Date && values.updatedAt instanceof Date);
  assert.equal(h.audits.length, 1);
  const detail = JSON.stringify(h.audits[0]!.entry);
  assert.equal(detail.includes('私密提示词不应进审计'), false, '审计 detail 不得包含提示词正文');
});

function actor() {
  return { id: 'admin-demo', role: 'admin' } as never;
}

function teamCreateBody(overrides: Row = {}): Row {
  return {
    name: '雷霆战机 PBL 导师团队',
    description: '协同导师团队',
    leaderAssistantId: 'tutor-leader',
    members: [
      { slotId: 'slot-leader', assistantId: 'tutor-leader', role: 'leader' },
      { assistantId: 'coach', role: 'coach' },
    ],
    concurrencyLimit: 2,
    pblSpec: {
      projectId: 'pbl-thunder-fighter',
      projectName: '雷霆战机',
      targetDomain: 'programming_game_dev',
      theoryMasteredGate: true,
      phases: [
        { phase: 'concept_mastery', title: '概念掌握', assignedAssistantId: 'coach' },
        { phase: 'guided_practice', title: '代码实践', assignedAssistantId: 'coach', gateCondition: 'code_playable_run_verified' },
      ],
    },
    ...overrides,
  };
}
