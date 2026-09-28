import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { InternalGrowthRecord } from './growthFixtures';
import { projectStudentEntry, projectStudentTimeline } from './projectStudentEntry';
import { MOCK_GROWTH_RECORDS } from './growthFixtures';

/**
 * T3 / #5：学生投影的证据化与「待观察」回归。
 *
 * 这些测试锁定客户端侧的投影契约：
 *  - 合法证据引用原样透传并推导出 `observed`；
 *  - 未知来源（如 raw_conversation）被丢弃；
 *  - 无证据 → `pending_observation`，绝不是 0；
 *  - 成人 / 原始字段与评分语义键都不会出现在学生投影里。
 */

function makeRecord(overrides: Partial<InternalGrowthRecord> = {}): InternalGrowthRecord {
  return {
    id: 'gr-test',
    type: 'objective_mastered',
    occurredAt: '2026-05-01T10:00:00Z',
    title: '测试结论',
    summaryStudent: '面向学生的描述。',
    summaryParent: '面向家长的描述。',
    summaryMentor: '内部班主任备注。',
    riskSignal: 'none',
    projectId: null,
    projectTitle: null,
    stage: null,
    artifactRef: null,
    objectiveTitles: ['测试目标'],
    evidenceIds: [],
    ...overrides,
  };
}

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

test('证据引用透传并推导出 observed', () => {
  const entry = projectStudentEntry(
    makeRecord({ evidenceIds: ['student_answer:answer-001', 'theory_check:theory-001'] }),
  );
  assert.ok(entry);
  assert.deepEqual(entry.evidenceIds, ['student_answer:answer-001', 'theory_check:theory-001']);
  assert.equal(entry.observationState, 'observed');
});

test('未知 / 非法证据来源被客户端白名单丢弃', () => {
  const entry = projectStudentEntry(
    makeRecord({
      evidenceIds: ['raw_conversation:turn-001', 'artifact:art-001', '  ', 'artifact:'],
    }),
  );
  assert.ok(entry);
  assert.deepEqual(entry.evidenceIds, ['artifact:art-001']);
  assert.equal(entry.observationState, 'observed');
});

test('无证据 → 待观察，而不是 0', () => {
  const entry = projectStudentEntry(makeRecord({ evidenceIds: [] }));
  assert.ok(entry);
  assert.deepEqual(entry.evidenceIds, []);
  assert.equal(entry.observationState, 'pending_observation');
  assert.equal(typeof entry.observationState, 'string');
});

test('成人来源类型被投影过滤掉', () => {
  for (const type of ['guardian_feedback', 'mentor_note', 'tutor_record', 'escalation_event'] as const) {
    assert.equal(projectStudentEntry(makeRecord({ type })), null);
  }
});

test('学生投影不含成人 / 原始字段，也不含评分语义键', () => {
  const entry = projectStudentEntry(
    makeRecord({ evidenceIds: ['artifact:art-001'], riskSignal: 'stall' }),
  );
  assert.ok(entry);

  const keys = collectKeys(entry);
  for (const forbidden of ['summaryParent', 'summaryMentor', 'riskSignal', 'rawConversation', 'voiceTranscript']) {
    assert.equal(keys.has(forbidden), false, `学生投影不应包含 ${forbidden}`);
  }
  for (const forbidden of ['score', 'rank', 'percentile', 'level', 'grade', 'points']) {
    assert.equal(keys.has(forbidden), false, `学生投影不应包含评分语义键 ${forbidden}`);
  }
});

test('mock 时间线包含一条「待观察」掌握记录，其余掌握记录都有证据', () => {
  const timeline = projectStudentTimeline(MOCK_GROWTH_RECORDS);
  const pending = timeline.items.filter((entry) => entry.observationState === 'pending_observation');
  assert.ok(pending.length >= 1, 'mock 应至少有一条待观察记录用于渲染验证');
  for (const entry of pending) {
    assert.equal(entry.evidenceIds.length, 0);
  }
});
