import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminTeamVersions, projectTemplateVersions, type Database } from '@qitu/database';
import { TutorService } from './tutor.service';
import type { TutorModelGateway } from './gateway-tutor.provider';
import { AuditWriter } from '../../common/audit/audit.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { LearningPlanStore, LearningProjectRecord } from '../learning-plan/learning-plan.store';
import type { AdminTeamConfig } from '@qitu/contracts';

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
  } as unknown as LearningPlanStore;

  const templateBindings = {
    resolveSnapshotForProject: async () => ({
      projectId: project.id,
      templateVersionId: project.templateVersionId,
      bindingId: 'binding-frozen',
      teamVersionId: 'team-ver-frozen',
      bindingHash: 'hash-frozen',
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
  assert.equal(context?.team?.teamId, 'team-ver-frozen');
  assert.equal(context?.team?.teamName, '冻结团队');
  assert.equal(context?.team?.assistantId, 'assistant-frozen');
  assert.equal(entries.some((entry) => entry.action === 'tutor.team.legacy-resolution'), false,
    '快照命中不得再走 legacy-resolution');
});

test('旧项目无快照：保留原解析路径并写 tutor.team.legacy-resolution 审计', async () => {
  const entries: AuditEntry[] = [];
  const auditWriter = {
    write: async (entry: AuditEntry) => { entries.push(entry); return 'audit-1'; },
  } as unknown as AuditWriter;

  const learningStore = {
    findProject: async () => ({ ...project }),
    listProjectsByStudent: async () => [],
  } as unknown as LearningPlanStore;

  const templateBindings = {
    resolveSnapshotForProject: async () => null,
  } as unknown as TemplateBindingService;

  const platformRegistry = {
    listAssistants: async () => [{
      id: 'assistant-stale', source: 'admin', name: '旧助手', avatar: '🏛️', description: '', role: 'assistant',
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
    database: fakeDb({ binding: { id: 'template-optics', title: '光学', slug: 'optics' } }),
    auditWriter,
    templateBindings,
  });

  const context = await tutor.getProjectContext(project.id, 'owner');
  assert.equal(context?.team?.teamId, 'team-stale');
  assert.equal(context?.team?.teamName, '旧团队');

  const legacy = entries.find((entry) => entry.action === 'tutor.team.legacy-resolution');
  assert.ok(legacy !== undefined, '旧项目无快照必须写 legacy-resolution 审计');
  assert.equal(legacy.targetType, 'project');
  assert.equal(legacy.targetId, project.id);
  assert.equal((legacy.detail as { teamId?: string }).teamId, 'team-stale');
});
