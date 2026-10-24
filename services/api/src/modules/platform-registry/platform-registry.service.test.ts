import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAssistants, adminTeamMembers, adminTeams, agentConfigs, agentSkillBindings, agentToolBindings, agentMcpBindings, projectTemplateVersions, runtimeMcpServers, tutorPartners, type Database } from '@qitu/database';
import { PlatformRegistryService } from './platform-registry.service';
import { PlatformRegistryController } from './platform-registry.controller';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyResult, IdempotentHandler } from '../../common/idempotency/idempotency.types';
import { parseAssistantCreate, parseTeamCreate } from './admin-ai-config.validation';
import { ADMIN_COPILOT_OPERATIONS, RUNTIME_TOOL_CATALOG } from '@qitu/contracts';
import { builtinToolRegistry } from './built-in-tools';
import { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { loadRuntimeSkillCatalog } from '../../common/tutor-runtime/runtime-source';
import { validateManagementSkill } from '../admin-copilot/copilot.resources';

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

test('persisted Agent scenario binding resolves dynamically, validates availability and preserves explicit overrides', async () => {
  const config = {
    id: 'scenario-tutor', displayName: 'Scenario Tutor', role: 'tutor', roleDefinition: 'Safe teaching role',
    agentDefinition: '', parentAgentId: null, enabled: true, modelUsage: 'tutor.chat',
    modelProviderId: null as string | null, modelId: null as string | null, configVersion: 1,
    capabilities: ['teach'],
  };
  const db = {
    select: () => ({ from: (table: unknown) => {
      if (table === agentConfigs) return Promise.resolve([config]);
      if (table === tutorPartners || table === runtimeMcpServers) return Promise.resolve([]);
      if ([agentSkillBindings, agentToolBindings, agentMcpBindings].includes(table as never)) return { where: async () => [] };
      throw new Error('unexpected table');
    } }),
  } as unknown as Database;
  let modelId = 'model-a';
  let available = true;
  const service = new PlatformRegistryService(db, 'live', { write: async () => 'audit' } as never, {
    getUsages: () => ({ usages: [], bindings: [] }),
    resolve: () => ({ providerId: 'provider', modelId }),
    resolvePurpose: () => ({ available }),
    listAgentModelOptions: () => ['model-a', 'model-b'].map((id) => ({ providerId: 'provider', modelId: id, modelLabel: id, available: true })),
  } as never);
  const first = await service.getAgentRuntime(config.id);
  assert.equal(first.agent.modelId, 'model-a');
  assert.equal(first.agent.modelBinding, 'usage');
  modelId = 'model-b';
  assert.equal((await service.getAgentRuntime(config.id)).agent.modelId, 'model-b');
  available = false;
  assert.equal((await service.getAgentRuntime(config.id)).agent.modelAvailable, false);
  assert.equal((await service.getAgentRuntime(config.id)).agent.modelId, null);
  config.modelProviderId = 'provider'; config.modelId = 'model-a';
  const explicit = await service.getAgentRuntime(config.id);
  assert.equal(explicit.agent.modelBinding, 'agent');
  assert.equal(explicit.agent.modelId, 'model-a');
});

test('admin tutor-leader switch gates the student Tutor runtime binding', async () => {
  const config = {
    id: 'qitu-learning-partner', displayName: '启途学习搭档', role: 'tutor',
    roleDefinition: 'Safe teaching role', agentDefinition: '', parentAgentId: null, enabled: true,
    modelUsage: 'tutor.chat', modelProviderId: null as string | null, modelId: null as string | null,
    configVersion: 1, capabilities: ['teach'],
  };
  const assistant = assistantRow({ id: 'tutor-leader', enabled: false });
  const db = {
    select: () => ({ from: (table: unknown) => {
      if (table === agentConfigs) return Promise.resolve([config]);
      if (table === adminAssistants) return Promise.resolve([assistant]);
      if (table === runtimeMcpServers) return Promise.resolve([]);
      if ([agentSkillBindings, agentToolBindings, agentMcpBindings].includes(table as never)) return { where: async () => [] };
      return Promise.resolve([]);
    } }),
  } as unknown as Database;
  const service = new PlatformRegistryService(
    db,
    'live',
    { write: async () => 'audit-id' } as never,
    {
      getUsages: () => ({ usages: [], bindings: [] }),
      resolvePurpose: () => ({ available: false }),
      listAgentModelOptions: () => [],
    } as never,
  );

  assert.equal((await service.getAgentRuntime(config.id)).agent.enabled, false);
  assistant.enabled = true;
  assert.equal((await service.getAgentRuntime(config.id)).agent.enabled, true);
});

test('student Tutor resolves the explicitly bound phase assistant switch', async () => {
  const assistant = assistantRow({ id: 'kinetic-experiment-guide', name: '动能定理仿真与实验向导', enabled: false });
  const db = {
    select: () => ({ from: (table: unknown) => table === adminAssistants ? Promise.resolve([assistant]) : Promise.resolve([]) }),
  } as unknown as Database;
  const service = new PlatformRegistryService(
    db,
    'live',
    { write: async () => 'audit-id' } as never,
    { getUsages: () => ({ usages: [], bindings: [] }) } as never,
  );

  assert.deepEqual(
    await service.getTutorAssistantStatusById('kinetic-experiment-guide'),
    { id: 'kinetic-experiment-guide', name: '动能定理仿真与实验向导', enabled: false },
  );
});

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
  const management = snapshot.skills.find(skill => skill.id === 'qitu-project-configurator');
  assert.equal(management?.runtime, 'admin');
  assert.equal(management?.publicationStatus, 'published');
  assert.match(management?.content ?? '', /qitu-copilot-contract:/);
  assert.equal(snapshot.agents.some((agent) => agent.id === 'admin'), false);
  const contextTool = snapshot.builtInTools.find(tool => tool.id === 'tutor.context_packet');
  assert.deepEqual(contextTool?.agentIds, []); // No persisted tool binding exists in this fixture.
  assert.equal(contextTool?.invocation, 'domain_service');
  const lessonTool = snapshot.builtInTools.find(tool => tool.id === 'tutor.propose_lesson_activity');
  assert.deepEqual(lessonTool?.agentIds, []);
  assert.equal(lessonTool?.invocation, 'model_tool');
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
function fakeConfigDb(state: { assistants: Row[]; teams: Row[]; members: Row[]; versions?: Row[] }) {
  const ops = { inserts: [] as Array<{ table: unknown; values: unknown }>, updates: [] as Array<{ table: unknown; set: Row }>, deletes: [] as unknown[] };
  const rowsFor = (table: unknown): Row[] => {
    if (table === adminAssistants) return state.assistants;
    if (table === adminTeams) return state.teams;
    if (table === adminTeamMembers) return state.members;
    if (table === projectTemplateVersions) return state.versions ?? [];
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
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        ops.inserts.push({ table, values });
        const p = Promise.resolve();
        return Object.assign(p, { onConflictDoNothing: () => p });
      },
    }),
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

/** 构造一个最小可用的 TutorRuntimeSource，避开真实文件系统。 */
function runtimeSourceStub(overrides: {
  rootStatus?: 'ready' | 'missing' | 'unreadable';
  detail?: string | null;
  skills?: Array<{ id: string; status?: 'ready' | 'unavailable'; content?: string }>;
  brokenPackages?: Array<{ id: string; detail: string }>;
} = {}) {
  const skills = (overrides.skills ?? [{ id: 'tutor-guided-learning' }]).map((skill) => ({
    id: skill.id,
    label: skill.id,
    description: null,
    version: null,
    contentHash: 'hash',
    status: skill.status ?? ('ready' as const),
    content: skill.content ?? '教学规则正文',
  }));
  return {
    root: '/deploy/qitu',
    policy: { id: 'AGENTS.md', version: 'v1', contentHash: null, status: 'ready' as const, content: '' },
    skills,
    skillsSource: {
      root: '/deploy/qitu/.agents/skills',
      status: overrides.rootStatus ?? ('ready' as const),
      detail: overrides.detail ?? null,
      brokenPackages: overrides.brokenPackages ?? [],
    },
  };
}

function readSkillsCheck(service: unknown, runtime?: unknown) {
  const readChecks = (service as {
    readChecks: (databaseAvailable: boolean, runtime?: unknown) => Promise<Array<Record<string, unknown>>>;
  }).readChecks.bind(service);
  return readChecks(false, runtime).then((checks) => checks.find((item) => item.id === 'runtime.skills'));
}

test('runtime.skills 健康检查映射目录状态并保留运维属性', async () => {
  const h = harness();
  for (const [runtime, expected, detailPattern] of [
    [runtimeSourceStub({ rootStatus: 'ready' }), 'ready', /就绪/],
    [runtimeSourceStub({ rootStatus: 'missing' }), 'missing', /migration 0015/],
    [runtimeSourceStub({ rootStatus: 'unreadable', detail: 'EACCES: permission denied' }), 'failed', /EACCES/],
    [undefined, 'unknown', /无法确认/],
  ] as const) {
    const check = await readSkillsCheck(h.service, runtime);
    assert.equal(check?.status, expected);
    assert.equal(check?.area, 'tutor');
    assert.equal(check?.operatorRequired, true);
    assert.equal(check?.executeAllowed, false);
    assert.match(String(check?.detail), detailPattern);
  }
});

test('目录可读但 seed 技能不可用时必须报 failed，不得看着绿其实空', async () => {
  const h = harness();
  // 反例：删掉 tutor-guided-learning 但保留其他目录 —— 旧实现会报 ready
  // 并声称「学生可以获得教学规则」，而 prompt 里实际什么也没有。
  for (const skills of [
    [{ id: 'some-other-skill' }],
    [{ id: 'tutor-guided-learning', status: 'unavailable' as const, content: '' }],
    [{ id: 'tutor-guided-learning', content: '   ' }],
  ]) {
    const check = await readSkillsCheck(h.service, runtimeSourceStub({ skills }));
    assert.equal(check?.status, 'failed');
    assert.match(String(check?.detail), /tutor-guided-learning/);
    assert.equal(check?.remediation !== null, true);
  }
});

test('无关技能包损坏不得把本项推离 ready，只进 detail', async () => {
  const h = harness();
  const check = await readSkillsCheck(h.service, runtimeSourceStub({
    brokenPackages: [{ id: 'broken-package', detail: 'ENOENT' }],
  }));
  assert.equal(check?.status, 'ready', '一个坏包不得让全局 overall 变 degraded');
  assert.match(String(check?.detail), /broken-package/);
});

test('健康检查 detail 用相对路径，不暴露部署绝对路径', async () => {
  const h = harness();
  const check = await readSkillsCheck(h.service, runtimeSourceStub());
  assert.match(String(check?.detail), /\.agents\/skills/);
  assert.equal(String(check?.detail).includes('/deploy/qitu'), false);
});

test('createAssistant 无 baseline，任何未知 Skill id 都被拒', async () => {
  const h = harness({ assistants: [], teams: [], members: [] });
  await assert.rejects(
    () => h.service.createAssistant(actor(), {
      name: '新助手', description: '', role: '', instructions: '', enabledSkills: ['fake-skill'],
    } as never),
    (error: unknown) => {
      const exception = error as { getStatus: () => number; getResponse: () => unknown };
      assert.equal(exception.getStatus(), 400);
      assert.match(JSON.stringify(exception.getResponse()), /fake-skill/);
      return true;
    },
  );
  assert.equal(h.ops.inserts.length, 0, '被拒的创建绝不能落库');
});

test('助手 PATCH 只校验补丁中出现的引用，并报告未知 Skill id', async () => {
  const h = harness({
    assistants: [assistantRow({ id: 'dirty', enabledSkills: ['legacy-skill'] })], teams: [], members: [],
  });
  await assert.rejects(
    () => h.service.updateAssistant(actor(), 'dirty', { enabledSkills: ['missing-skill'] }),
    (error: unknown) => {
      const exception = error as { getStatus: () => number; getResponse: () => unknown };
      assert.equal(exception.getStatus(), 400);
      assert.match(JSON.stringify(exception.getResponse()), /missing-skill/);
      return true;
    },
  );
  assert.equal(h.ops.updates.length, 0);
  await h.service.updateAssistant(actor(), 'dirty', { name: '只改名称' });
  assert.equal(h.ops.updates.length, 1, '不含 enabledSkills 的 PATCH 不应因存量脏数据失败');
});

test('助手 PATCH 携带存量脏引用时放行，但仍拦本次新引入的未知 id', async () => {
  const h = harness({
    assistants: [assistantRow({ id: 'dirty', enabledSkills: ['legacy-skill'], toolIds: ['legacy-tool'] })],
    teams: [], members: [],
  });

  // 管理面矩阵的真实提交形状：存量数组 ± 一项（tools/page.tsx:213-216、264-266）。
  // 若连存量脏 id 一起拒，任何历史助手都无法再被授权。
  const updated = await h.service.updateAssistant(actor(), 'dirty', {
    enabledSkills: ['legacy-skill', 'tutor-guided-learning'],
    toolIds: ['legacy-tool', 'tutor.context_packet'],
  });
  assert.deepEqual([...updated.enabledSkills], ['legacy-skill', 'tutor-guided-learning']);
  assert.deepEqual([...updated.toolIds], ['legacy-tool', 'tutor.context_packet']);

  // 存量脏引用不被静默清理，仍由 danglingBindings 暴露。
  const snapshot = await h.service.getSnapshot();
  assert.deepEqual(snapshot.danglingBindings?.map((entry) => entry.assistantId), ['dirty']);

  await assert.rejects(
    () => h.service.updateAssistant(actor(), 'dirty', { toolIds: ['legacy-tool', 'another-fake'] }),
    (error: unknown) => {
      const exception = error as { getStatus: () => number; getResponse: () => unknown };
      assert.equal(exception.getStatus(), 400);
      assert.match(JSON.stringify(exception.getResponse()), /another-fake/);
      return true;
    },
  );
});

test('runtime snapshot 只列出存在问题的助手绑定', async () => {
  const h = harness({
    assistants: [
      assistantRow({ id: 'dirty', enabledSkills: ['missing-skill'], toolIds: ['missing-tool'], mcpServerIds: ['missing-mcp'] }),
      assistantRow({ id: 'clean', enabledSkills: ['tutor-guided-learning'], toolIds: ['tutor.context_packet'], mcpServerIds: [] }),
    ],
    teams: [], members: [],
  });
  const snapshot = await h.service.getSnapshot();
  assert.deepEqual(snapshot.danglingBindings, [{
    assistantId: 'dirty',
    source: 'builtin',
    unknownSkillIds: ['missing-skill'],
    unknownToolIds: ['missing-tool'],
    unknownMcpServerIds: ['missing-mcp'],
  }]);
});

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

test('merged runtime registry retains canonical tool behavior and freezes the actual lesson candidate schema', () => {
  const tools = builtinToolRegistry.list();
  assert.equal(new Set(tools.map(tool => tool.id)).size, tools.length);
  for (const canonical of RUNTIME_TOOL_CATALOG) {
    const tool = tools.find(tool => tool.id === canonical.id);
    assert.equal(tool?.invocation, canonical.invocation);
    assert.deepEqual(tool?.agentIds, []);
    const descriptor = builtinToolRegistry.listForAgentIds([canonical.id])[0];
    assert.equal(descriptor?.version, canonical.version);
    assert.deepEqual(descriptor?.capabilities, canonical.capabilities);
    if (canonical.inputSchema) assert.equal(descriptor?.inputSchemaDigest, teachingValueDigest(canonical.inputSchema));
  }
  const lesson = builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity'])[0];
  assert.equal(lesson?.inputSchemaDigest, teachingValueDigest(LESSON_ACTIVITY_SCHEMA));
  assert.deepEqual(lesson?.capabilities, ['teach']);
  assert.deepEqual(builtinToolRegistry.listForAgentIds(['unregistered-tool']), []);
});

test('management capability union keeps governed publication, revocation, binding and growth operations in the checked Skill contract', () => {
  const skill = loadRuntimeSkillCatalog().skills.find(item => item.id === 'qitu-project-configurator');
  assert.equal(validateManagementSkill(skill).id, 'qitu-project-configurator');
  const ids = ADMIN_COPILOT_OPERATIONS.map(operation => operation.kind);
  assert.equal(new Set(ids).size, ids.length);
  for (const kind of ['binding.prepare', 'binding.activate', 'growth.projection.configure', 'skill.revoke'] as const) assert.ok(ids.includes(kind));
  assert.deepEqual(ADMIN_COPILOT_OPERATIONS.find(operation => operation.kind === 'skill.revoke')?.scopes, ['global']);
});
