import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ParentGrowthEntry, ParentGrowthSummary } from '@qitu/contracts';
import {
  buildParentGrowthExportDocument,
  decideGrowthExportAccess,
} from './growth-export.projection';
import type { GrowthExportRecord } from './growth-export.types';

/**
 * 导出安全边界的**纯函数**单测：白名单投影 + 状态 / 授权判定。
 *
 * 不需要 Postgres，也不需要 Nest 容器——这两个函数就是导出的全部安全逻辑。
 */

const FORBIDDEN_KEYS = [
  'rawConversation',
  'rawVoice',
  'voiceTranscript',
  'riskLevel',
  'riskTags',
  'internalNote',
  'email',
  'modelInference',
  'score',
  'rank',
  'percentile',
  'level',
  'password',
  'token',
] as const;

function collectKeys(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    found.add(key);
    collectKeys(nested, found);
  }
}

/* ------------------------- 白名单投影 ------------------------- */

test('投影只保留白名单字段：原始对话 / 语音 / 风险 / 邮箱 / 模型推断都不带出', () => {
  const summary = {
    childId: 'student-demo',
    childDisplayName: '小宇',
    streakDays: 3,
    projectsCompleted: 1,
    objectivesMastered: 2,
    artifactsPublished: 1,
    lastActivityAt: '2025-01-02T03:04:05.000Z',
    // 以下都是必须被丢弃的越界字段。
    email: 'child@example.com',
    riskLevel: 'high',
    modelInference: { predictedGrade: 'A' },
  } as unknown as ParentGrowthSummary;

  const entry = {
    id: 'growth-1',
    type: 'project_stage_completed',
    occurredAt: '2025-01-02T03:04:05.000Z',
    title: '完成一次理论学习',
    summaryParent: '孩子完成了一次理论学习。',
    projectTitle: '校园植物观察手册',
    stage: 'theory_learning',
    artifactRef: null,
    rawConversation: '孩子对 AI 说：我不想学了',
    voiceTranscript: '原始语音转写',
    riskTags: ['disengaged'],
    score: 88,
    rank: 3,
  } as unknown as ParentGrowthEntry;

  const document = buildParentGrowthExportDocument({
    exportId: 'pge-1',
    childId: 'student-demo',
    childDisplayName: '小宇',
    generatedAt: new Date('2025-01-02T00:00:00.000Z'),
    expiresAt: new Date('2025-01-03T00:00:00.000Z'),
    summary,
    entries: [entry],
    truncated: false,
  });

  // 顶层与正文的关键字段保留。
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.exportId, 'pge-1');
  assert.equal(document.summary.childId, 'student-demo');
  assert.equal(document.entries.length, 1);
  assert.equal(document.entries[0]!.summaryParent, '孩子完成了一次理论学习。');

  // 深度扫描：任何层级都不允许出现禁区字段。
  const keys = new Set<string>();
  collectKeys(document, keys);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.has(forbidden), false, `导出正文不应包含字段 ${forbidden}`);
  }

  // 正文中也不应出现原始对话文本。
  assert.equal(JSON.stringify(document).includes('我不想学了'), false);
});

test('投影显式重建条目：条目字段集等于白名单', () => {
  const entry: ParentGrowthEntry = {
    id: 'growth-9',
    type: 'artifact_published',
    occurredAt: '2025-02-02T00:00:00.000Z',
    title: '发布作品',
    summaryParent: '作品已发布。',
    projectTitle: null,
    stage: 'published',
    artifactRef: 'artifact-9',
  };
  const document = buildParentGrowthExportDocument({
    exportId: 'pge-9',
    childId: 'student-demo',
    childDisplayName: '小宇',
    generatedAt: new Date('2025-02-02T00:00:00.000Z'),
    expiresAt: new Date('2025-02-03T00:00:00.000Z'),
    summary: {
      childId: 'student-demo',
      childDisplayName: '小宇',
      streakDays: 0,
      projectsCompleted: 0,
      objectivesMastered: 0,
      artifactsPublished: 1,
      lastActivityAt: null,
    },
    entries: [entry],
    truncated: true,
  });

  assert.deepEqual(Object.keys(document.entries[0]!).sort(), [
    'artifactRef',
    'id',
    'occurredAt',
    'projectTitle',
    'stage',
    'summaryParent',
    'title',
    'type',
  ]);
  assert.equal(document.truncated, true);
});

/* ------------------------- 状态 / 授权判定 ------------------------- */

const NOW = new Date('2025-03-01T12:00:00.000Z');

function makeRecord(overrides: Partial<GrowthExportRecord> = {}): GrowthExportRecord {
  return {
    id: 'pge-1',
    parentId: 'parent-1',
    childId: 'student-1',
    childDisplayName: '小宇',
    status: 'ready',
    reason: '了解孩子近期成长',
    document: null,
    createdAt: new Date('2025-03-01T00:00:00.000Z'),
    readyAt: new Date('2025-03-01T00:00:00.000Z'),
    expiresAt: new Date('2025-03-02T00:00:00.000Z'),
    downloadedAt: null,
    ...overrides,
  };
}

test('记录不存在 → not_found', () => {
  assert.equal(
    decideGrowthExportAccess({ record: null, actorId: 'parent-1', now: NOW, guardianActive: true }),
    'not_found',
  );
});

test('记录属于别的家长 → not_found（不泄露存在性）', () => {
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord({ parentId: 'parent-2' }),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: true,
    }),
    'not_found',
  );
});

test('监护关系已撤销 → forbidden（即使记录属于本人）', () => {
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord(),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: false,
    }),
    'forbidden',
  );
});

test('正文尚未生成（pending）→ not_ready', () => {
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord({ status: 'pending' }),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: true,
    }),
    'not_ready',
  );
});

test('状态已置 expired → expired', () => {
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord({ status: 'expired' }),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: true,
    }),
    'expired',
  );
});

test('超过有效期 → expired（边界：等于 expiresAt 也算过期）', () => {
  const expiresAt = new Date('2025-03-01T11:59:59.000Z');
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord({ expiresAt }),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: true,
    }),
    'expired',
  );
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord({ expiresAt: NOW }),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: true,
    }),
    'expired',
  );
});

test('归属正确、授权有效、未过期 → ok', () => {
  assert.equal(
    decideGrowthExportAccess({
      record: makeRecord(),
      actorId: 'parent-1',
      now: NOW,
      guardianActive: true,
    }),
    'ok',
  );
});
