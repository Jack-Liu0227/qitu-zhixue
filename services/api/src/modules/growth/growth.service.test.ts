import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { DirectoryPersonRef } from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';
import { GrowthService, type GrowthRecordInput } from './growth.service';

/**
 * T3 / #5：成长档案证据化正向反馈的服务端回归。
 *
 * 覆盖 ISSUES 的验证要求：
 *  - `evidenceIds` 往返（roundtrip）与白名单过滤；
 *  - 学生 / 家长投影都不含原始字段与内部风险标签；
 *  - 无证据 → 「待观察」，绝不是 0；
 *  - 契约里没有 score / rank / percentile / level 语义。
 */

/* ----------------------------- 测试替身 ----------------------------- */

function makeDirectory(): DirectoryService {
  const users: Record<string, DirectoryPersonRef> = {
    'student-test': { userId: 'student-test', email: 'student-test@qtzx.local', displayName: '测试学生', role: 'student' },
    'parent-test': { userId: 'parent-test', email: 'parent-test@qtzx.local', displayName: '测试家长', role: 'parent' },
  };
  const guardians: Record<string, string[]> = { 'parent-test': ['student-test'] };

  const directory = {
    findUser: async (id: string) => users[id] ?? null,
    childrenOfParent: async (pid: string) => (guardians[pid] ?? []).map((id) => users[id]!),
  };
  return directory as unknown as DirectoryService;
}

function makeService(): GrowthService {
  return new GrowthService(makeDirectory());
}

function makeProfileService(rows: Array<Record<string, unknown>>): Promise<Awaited<ReturnType<GrowthService['getStudentProfile']>>> {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    }),
  };
  return new GrowthService(makeDirectory(), undefined, undefined, undefined, db as never).getStudentProfile('student-test');
}

const baseInput: GrowthRecordInput = {
  studentId: 'student-test',
  type: 'objective_mastered',
  occurredAt: '2026-05-01T10:00:00.000Z',
  title: '掌握「测试目标」',
  summaryStudent: '你在测试里说明了这个目标。',
  summaryParent: '孩子掌握了一个测试目标。',
  objectiveTitles: ['测试目标'],
};

const EMPTY_QUERY = {
  type: 'all' as const,
  projectId: null,
  from: null,
  to: null,
  cursor: null,
  limit: 20,
};

test('student profile composition does not invent expert conclusions without accepted projection output', async () => {
  const profile = await makeService().getStudentProfile('student-test');
  assert.equal(profile.freshness, 'unavailable');
  assert.deepEqual(profile.strengths, []);
  assert.equal(profile.trajectory, null);
  assert.equal(profile.provenance.profileAssistantId, 'learner-profile');
  assert.equal(profile.provenance.growthAssistantId, 'growth-analyst');
});

test('student profile composition parses only the latest accepted expert projections', async () => {
  const profile = await makeProfileService([
    {
      agentId: 'learner-profile',
      projectionType: 'learner_profile',
      payload: {
        result: {
          version: 3,
          interests: ['光学'],
          strengths: ['证据推理'],
          preferences: ['先做模拟再复盘'],
          nextQuestions: ['如何验证散射模型？'],
        },
      },
      createdAt: new Date('2026-10-20T10:00:00.000Z'),
    },
    {
      agentId: 'growth-analyst',
      projectionType: 'growth_trajectory',
      payload: {
        result: {
          version: 2,
          milestones: ['完成一次可复现实验'],
          studentSummary: '你开始用证据解释现象。',
          evidenceRefs: ['artifact:artifact-1'],
          confidence: 'medium',
        },
      },
      createdAt: new Date('2026-10-20T09:00:00.000Z'),
    },
  ]);
  assert.equal(profile.freshness, 'fresh');
  assert.deepEqual(profile.interests, ['光学']);
  assert.deepEqual(profile.strengths, ['证据推理']);
  assert.equal(profile.trajectory?.studentSummary, '你开始用证据解释现象。');
  assert.deepEqual(profile.trajectory?.evidenceRefs, ['artifact:artifact-1']);
  assert.equal(profile.updatedAt, '2026-10-20T10:00:00.000Z');
});

/* --------------------------- 禁止字段扫描 --------------------------- */

/** 任何分数 / 排名 / 百分位 / 等级语义的键名都不允许出现在契约里。 */
const FORBIDDEN_POLICY_KEYS = [
  'score',
  'scores',
  'rank',
  'rankings',
  'percentile',
  'level',
  'grade',
  'rating',
  'points',
  'stars',
];

/** 原始 / 成人 / 内部字段绝不能进入学生或家长投影。 */
const FORBIDDEN_INTERNAL_KEYS = [
  'summaryParent',
  'summaryMentor',
  'riskSignal',
  'riskLevel',
  'internalNote',
  'mentorNote',
  'guardianFeedback',
  'rawConversation',
  'rawVoice',
  'voiceTranscript',
  'visibility',
  'email',
  'password',
  'token',
];

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

/* ------------------------------- 用例 ------------------------------- */

test('证据往返：合法的 evidenceIds 进入时间线，非法来源被白名单丢弃', async () => {
  const service = makeService();
  await service.record({
    ...baseInput,
    evidenceIds: [
      'student_answer:answer-001',
      'theory_check:theory-001',
      'raw_conversation:turn-001', // 未知来源，必须丢弃
      'student_answer:answer-001', // 重复，必须去重
      '   ', // 非法，必须丢弃
    ],
  });

  const [entry] = service.getTimeline('student-test', EMPTY_QUERY).items;
  assert.ok(entry, '应返回一条记录');
  assert.deepEqual(entry.evidenceIds, ['student_answer:answer-001', 'theory_check:theory-001']);
  assert.equal(entry.observationState, 'observed');
});

test('无证据 → 待观察：不产生 0 或任何数值判定', async () => {
  const service = makeService();
  await service.record(baseInput); // 未提供 evidenceIds

  const [entry] = service.getTimeline('student-test', EMPTY_QUERY).items;
  assert.ok(entry);
  assert.deepEqual(entry.evidenceIds, []);
  assert.equal(entry.observationState, 'pending_observation');
  assert.equal(typeof entry.observationState, 'string');
});

test('学生投影不含原始 / 成人 / 内部字段，也不含分数排名等级语义', async () => {
  const service = makeService();
  await service.record({
    ...baseInput,
    evidenceIds: ['artifact:artifact-001'],
    encouragement: '继续保持。',
  });

  const timeline = service.getTimeline('student-test', EMPTY_QUERY);
  const keys = collectKeys(timeline);

  for (const forbidden of FORBIDDEN_INTERNAL_KEYS) {
    assert.equal(keys.has(forbidden), false, `学生投影不应包含 ${forbidden}`);
  }
  for (const forbidden of FORBIDDEN_POLICY_KEYS) {
    assert.equal(keys.has(forbidden), false, `学生投影不应包含评分语义键 ${forbidden}`);
  }
});

test('家长投影保持最小可见范围：无 evidenceIds / observationState / 原始字段', async () => {
  const service = makeService();
  await service.record({ ...baseInput, evidenceIds: ['artifact:artifact-001'] });

  const page = await service.getParentPage('student-test', EMPTY_QUERY);
  const keys = collectKeys(page);

  assert.equal(keys.has('evidenceIds'), false);
  assert.equal(keys.has('observationState'), false);
  // `summaryParent` 是家长投影的合法文案；其余内部 / 原始字段仍必须缺席。
  for (const forbidden of FORBIDDEN_INTERNAL_KEYS.filter((key) => key !== 'summaryParent')) {
    assert.equal(keys.has(forbidden), false, `家长投影不应包含 ${forbidden}`);
  }
  for (const forbidden of FORBIDDEN_POLICY_KEYS) {
    assert.equal(keys.has(forbidden), false, `家长投影不应包含评分语义键 ${forbidden}`);
  }

  // 家长投影字段被显式冻结，多一个键都算越界。
  assert.deepEqual(Object.keys(page.timeline.items[0]!).sort(), [
    'artifactRef',
    'id',
    'occurredAt',
    'projectTitle',
    'stage',
    'summaryParent',
    'title',
    'type',
  ]);
});

test('演示数据：所有目标掌握类记录都带证据，观察状态不会退化为 0', () => {
  const service = makeService();
  const masteries = service
    .getTimeline('student-demo', { ...EMPTY_QUERY, type: 'objective_mastered' })
    .items;

  assert.ok(masteries.length > 0);
  for (const entry of masteries) {
    assert.ok(entry.evidenceIds.length > 0, `目标 ${entry.title} 应携带证据`);
    assert.equal(entry.observationState, 'observed');
  }
});
