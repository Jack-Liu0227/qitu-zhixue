import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminTeamVersions, projectTemplateVersions, pblGateEvidence, type Database } from '@qitu/database';
import { TutorService } from './tutor.service';
import type { TutorModelGateway } from './gateway-tutor.provider';
import { AuditWriter } from '../../common/audit/audit.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { LearningPlanStore, LearningProjectRecord } from '../learning-plan/learning-plan.store';
import type { AdminTeamConfig } from '@qitu/contracts';
import { ConflictException } from '@nestjs/common';

/**
 * A1：正式项目必须按创建时冻结的绑定快照解析团队；退役/重新激活绑定不得改写
 * 既有项目。没有快照的旧项目保留原解析路径并写 `tutor.team.legacy-resolution` 审计。
 */

const project: LearningProjectRecord = {
  id: 'project-frozen',
  studentId: 'owner',
  templateVersionId: 'tv-frozen',
  status: 'theory_learning',
  currentStageIndex: 0,
  stageTotal: 10,
  progressPercent: 0,
  title: '光学',
  subtitle: null,
  tags: ['optics'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  completedAt: null,
};

function fakeDb(input: { frozenTeam?: unknown; binding?: unknown }): Database {
  const select = () => ({
    from: (table: unknown) => {
      if (table === pblGateEvidence) return { where: async () => [] };
      if (table === adminTeamVersions) {
        return {
          where: () => ({ limit: async () => (input.frozenTeam === undefined ? [] : [input.frozenTeam]) }),
        };
      }
      if (table === projectTemplateVersions) {
        return {
          innerJoin: () => ({
            where: () => ({ limit: async () => (input.binding === undefined ? [] : [input.binding]) }),
          }),
        };
      }
      throw new Error(`unexpected table in fake db: ${String(table)}`);
    },
  });
  return { select } as unknown as Database;
}

function frozenTeamRow(overrides: Partial<AdminTeamConfig> = {}): Record<string, unknown> {
  return {
    id: 'team-ver-frozen',
    teamId: 'team-frozen',
    version: 3,
    name: '冻结团队',
    description: 'frozen',
    workspaceMode: 'guided',
    sessionMode: '1v1',
    leaderAssistantId: 'assistant-frozen',
    members: [],
    pblSpec: {},
    enabled: true,
    createdBy: 'admin',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function newTutor(input: {
  learningStore: LearningPlanStore;
  platformRegistry: PlatformRegistryService;
  database: Database;
  auditWriter?: AuditWriter;
  templateBindings?: TemplateBindingService;
}): TutorService {
  return new TutorService(
    'live',
    { complete: async () => { throw new Error('not called'); } } as unknown as TutorModelGateway,
    undefined, // platformData
    undefined, // stallSink
    undefined, // workspace
    undefined, // store
    undefined, // idempotencyStore
    input.auditWriter, // auditWriter (8)
    undefined, // sdkFactory
    undefined, // projects
    input.platformRegistry, // platformRegistry (11)
    undefined, // teamRuntime
    input.learningStore, // learningStore (13)
    undefined, // ima
    undefined, // imaSettings
    undefined, // managedKnowledge
    undefined, // templates
    input.database, // database (18)
    input.templateBindings, // templateBindings (19)
  );
}

test('快照命中：团队来自冻结 teamVersionId，退役/重新激活绑定不改写既有项目', async () => {
  const entries: AuditEntry[] = [];
  const auditWriter = {
    write: async (entry: AuditEntry) => { entries.push(entry); return 'audit-1'; },
  } as unknown as AuditWriter;

  const learningStore = {
    findProject: async () => ({ ...project }),
    listProjectsByStudent: async () => [],
    listPlansByStudent: async () => [],
  } as unknown as LearningPlanStore;

  const templateBindings = {
    findFrozenSnapshotForProject: async () => ({
      projectId: project.id,
      templateVersionId: project.templateVersionId,
      bindingId: 'binding-frozen',
      teamVersionId: 'team-ver-frozen',
      bindingHash: 'hash-frozen',
      bundleDigest: null,
      boundAt: '2026-01-01T00:00:00.000Z',
      backfilled: false,
    }),
  } as unknown as TemplateBindingService;

  // 旧解析路径如果被走到，会解析到「旧团队」；快照命中时必须拿到「冻结团队」。
  const platformRegistry = {
    listAssistants: async () => [{
      id: 'assistant-frozen', source: 'admin', name: '冻结助手', avatar: '❄️', description: '', role: 'assistant',
      enabled: true, sortOrder: 0, modelProviderId: null, modelId: null, instructions: '', enabledSkills: [],
      toolIds: [], mcpServerIds: [],
    }],
    listTeams: async () => [{
      id: 'team-stale', name: '旧团队', description: '', workspaceMode: 'guided', sessionMode: '1v1',
      leaderAssistantId: 'assistant-stale', members: [], concurrencyLimit: 1,
      pblSpec: { projectName: '光学' }, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  } as unknown as PlatformRegistryService;

  const tutor = newTutor({
    learningStore,
    platformRegistry,
    database: fakeDb({ frozenTeam: frozenTeamRow() }),
    auditWriter,
    templateBindings,
  });

  const context = await tutor.getProjectContext(project.id, 'owner');
  assert.equal(context?.team?.teamId, 'team-frozen');
  assert.equal(context?.team?.teamName, '冻结团队');
  assert.equal(context?.team?.assistantId, 'assistant-frozen');
  assert.equal(entries.some((entry) => entry.action === 'tutor.team.legacy-resolution'), false,
    '快照命中不得再走 legacy-resolution');
});

test('missing frozen snapshot fails visibly without a legacy team fallback', async () => {
  let legacyReads = 0;
  const tutor = newTutor({
    learningStore: { findProject: async () => ({ ...project }) } as unknown as LearningPlanStore,
    templateBindings: { findFrozenSnapshotForProject: async () => null } as unknown as TemplateBindingService,
    database: fakeDb({}),
    platformRegistry: {
      listTeams: async () => { legacyReads += 1; return []; },
      getTeamForTemplateVersion: async () => { legacyReads += 1; return null; },
    } as unknown as PlatformRegistryService,
  });
  await assert.rejects(tutor.getProjectContext(project.id, 'owner'), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, 'PROJECT_BINDING_RECONFIRM_REQUIRED');
    return true;
  });
  assert.equal(legacyReads, 0);
});

test('missing binding service fails closed without consulting the mutable roster', async () => {
  let legacyReads = 0;
  const tutor = newTutor({
    learningStore: { findProject: async () => ({ ...project }) } as unknown as LearningPlanStore,
    database: fakeDb({}),
    platformRegistry: {
      listAssistants: async () => [],
      listTeams: async () => { legacyReads += 1; return []; },
      getTeamForTemplateVersion: async () => { legacyReads += 1; return null; },
    } as unknown as PlatformRegistryService,
  });
  await assert.rejects(tutor.getProjectContext(project.id, 'owner'), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, 'PROJECT_BINDING_RECONFIRM_REQUIRED');
    return true;
  });
  assert.equal(legacyReads, 0);
});

test('a required bundle rejected by the binding owner fails closed before mutable team lookup', async () => {
  const tutor = newTutor({
    learningStore: { findProject: async () => ({ ...project }) } as unknown as LearningPlanStore,
    templateBindings: {
      findFrozenSnapshotForProject: async () => null,
    } as unknown as TemplateBindingService,
    database: fakeDb({ frozenTeam: frozenTeamRow() }),
    platformRegistry: {
      listAssistants: async () => [],
      listTeams: async () => { throw new Error('mutable roster must not be read'); },
    } as unknown as PlatformRegistryService,
  });
  await assert.rejects(tutor.getProjectContext(project.id, 'owner'), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, 'PROJECT_BINDING_RECONFIRM_REQUIRED');
    return true;
  });
});

const opticsMembers = [
  { assistantId: 'optics-leader', roleLabel: '物理总导师', phaseScope: 'exploration' },
  { assistantId: 'optics-concept-coach', roleLabel: '概念教练', phaseScope: 'concept_mastery' },
  { assistantId: 'optics-experiment-guide', roleLabel: '仿真向导', phaseScope: 'guided_practice' },
  { assistantId: 'optics-review-assessor', roleLabel: '评审导师', phaseScope: 'deliverable_review' },
];

function opticsTutor(options: { disabled?: string; missing?: string; runtimeStatus?: 'running' | 'failed'; runtimeError?: boolean; teamEnabled?: boolean } = {}) {
  const tutor = newTutor({
    learningStore: { findProject: async () => ({ ...project }) } as unknown as LearningPlanStore,
    templateBindings: { findFrozenSnapshotForProject: async () => ({
      projectId: project.id, templateVersionId: project.templateVersionId,
      bindingId: 'binding-optics', teamVersionId: 'tv-optics-1',
      bindingHash: 'hash-optics', bundleDigest: 'bundle-optics',
      boundAt: new Date().toISOString(), backfilled: false,
    }) } as unknown as TemplateBindingService,
    database: fakeDb({ frozenTeam: frozenTeamRow({
      leaderAssistantId: 'optics-concept-coach',
      members: opticsMembers as unknown as AdminTeamConfig['members'],
      enabled: options.teamEnabled ?? true,
      pblSpec: { phases: opticsMembers.map((m) => ({ phase: m.phaseScope, assignedAssistantId: m.assistantId, title: m.roleLabel })) } as unknown as AdminTeamConfig['pblSpec'],
    }) }),
    platformRegistry: {
      listAssistants: async () => opticsMembers.filter((m) => m.assistantId !== options.missing).map((m) => ({ id: m.assistantId, name: m.roleLabel + '真实姓名', enabled: m.assistantId !== options.disabled, avatar: '🔦' })),
      listTeams: async () => { throw Error('frozen teams must not use live roster'); },
    } as unknown as PlatformRegistryService,
  });
  Object.assign(tutor, { teamRuntime: { getStudentTeamRuntimeProjection: async () => {
    if (options.runtimeError) throw Error('runtime unavailable');
    return { runId: options.runtimeStatus ? 'run-real' : null, agents: options.runtimeStatus ? {
      'optics-concept-coach': { status: options.runtimeStatus, currentTaskSummary: '真实任务', messages: [], toolCalls: [] },
    } : {} };
  } } });
  return tutor;
}

test('简写冻结团队解析出四位真实导师、稳定槽位、角色和阶段，不从可变团队替换名册', async () => {
  const tutor = opticsTutor();
  const graph = await tutor.getTeamGraph(project.id, 'owner');
  const again = await tutor.getTeamGraph(project.id, 'owner');
  assert.equal(graph.team.teamId, 'team-frozen');
  assert.equal(graph.agents.length, 4);
  assert.deepEqual(graph.agents.map((a) => a.assistantId), opticsMembers.map((m) => m.assistantId));
  assert.deepEqual(graph.agents.map((a) => a.pblPhase), opticsMembers.map((m) => m.phaseScope));
  assert.deepEqual(graph.agents.map((a) => a.role), ['coach', 'leader', 'coach', 'reviewer']);
  for (const agent of graph.agents) {
    assert.ok(agent.slotId);
    assert.ok(agent.name.endsWith('真实姓名'));
    assert.equal(agent.status, 'ready');
    assert.deepEqual(agent.messages, []);
    assert.deepEqual(agent.toolCalls, []);
  }
  assert.deepEqual(graph.agents.map((a) => a.slotId), again.agents.map((a) => a.slotId));
  assert.equal(graph.runId, null);
  await assert.rejects(() => tutor.getTeamGraph(project.id, 'other-student'), (error: any) => error.getStatus() === 403);
});

test('禁用助手或团队保持 offline，真实 runtime 状态保留，runtime 失败不可伪装就绪', async () => {
  for (const status of ['running', 'failed'] as const) {
    const graph = await opticsTutor({ runtimeStatus: status }).getTeamGraph(project.id, 'owner');
    assert.equal(graph.runId, 'run-real');
    assert.equal(graph.agents[1]?.status, status);
    assert.equal(graph.agents[1]?.currentTaskSummary, '真实任务');
  }
  const disabled = await opticsTutor({ disabled: 'optics-concept-coach', runtimeStatus: 'running' }).getTeamGraph(project.id, 'owner');
  assert.equal(disabled.agents[1]?.status, 'offline');
  const missing = await opticsTutor({ missing: 'optics-experiment-guide' }).getTeamGraph(project.id, 'owner');
  assert.equal(missing.agents[2]?.status, 'offline');
  assert.equal(missing.agents[2]?.assistantId, 'optics-experiment-guide');
  for (const options of [{ runtimeError: true }, { teamEnabled: false }]) {
    const graph = await opticsTutor(options).getTeamGraph(project.id, 'owner');
    assert.ok(graph.agents.every((a) => a.status === 'offline'));
  }
});
