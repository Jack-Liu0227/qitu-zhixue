import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROWTH_EVIDENCE_SOURCE_KINDS,
  MAX_EVIDENCE_IDS_PER_ENTRY,
  normaliseEvidenceIds,
  observationStateFor,
  parseEvidenceId,
} from './growth.evidence';

/**
 * T3 / #5：证据引用白名单与「待观察」推导的纯函数回归。
 *
 * 这一组锁定 R-T3（证据不足被展示为 0 分或负面结论）的服务端前提：
 *  - 只有 `sourceKind:opaqueId` 且来源在白名单内才被保留；
 *  - 原始对话 / 语音 / 未知来源一律丢弃；
 *  - 无证据 → `pending_observation`，绝不产生 0 或任何数值判定。
 */

test('白名单：合法的 sourceKind:opaqueId 被保留，未知来源与原始字段被丢弃', () => {
  const result = normaliseEvidenceIds([
    'student_answer:answer-001',
    'theory_check:theory-001',
    'artifact:artifact-001',
    'reflection:reflection-001',
    'help_request:help-001',
    // 以下全部应被丢弃：
    'raw_conversation:turn-001', // 未知来源种类
    'voice_transcript:voice-001', // 未列入白名单
    'risk_signal:stall', // 内部风险标签
    'student_answer:', // 缺 opaqueId
    ':answer-001', // 缺 sourceKind
    'student_answer:answer 001', // 含空白
    'student_answer:answer:001', // opaqueId 含冒号
    '', // 空串
  ]);

  assert.deepEqual(result, [
    'student_answer:answer-001',
    'theory_check:theory-001',
    'artifact:artifact-001',
    'reflection:reflection-001',
    'help_request:help-001',
  ]);
});

test('白名单：非数组 / 非字符串输入安全返回空数组', () => {
  assert.deepEqual(normaliseEvidenceIds(undefined), []);
  assert.deepEqual(normaliseEvidenceIds(null), []);
  assert.deepEqual(normaliseEvidenceIds('student_answer:answer-001'), []);
  assert.deepEqual(normaliseEvidenceIds([1, true, {}, null]), []);
});

test('白名单：去重保序并有硬上限', () => {
  const dup = normaliseEvidenceIds(['artifact:a', 'artifact:a', 'artifact:b']);
  assert.deepEqual(dup, ['artifact:a', 'artifact:b']);

  const many = Array.from({ length: MAX_EVIDENCE_IDS_PER_ENTRY + 10 }, (_, i) => `artifact:ev-${i}`);
  assert.equal(normaliseEvidenceIds(many).length, MAX_EVIDENCE_IDS_PER_ENTRY);
});

test('parseEvidenceId 只接受闭合来源集合', () => {
  assert.deepEqual(parseEvidenceId('artifact:artifact-001'), {
    sourceKind: 'artifact',
    opaqueId: 'artifact-001',
  });
  assert.equal(parseEvidenceId('nope:001'), null);
  assert.equal(parseEvidenceId(42), null);
});

test('observationStateFor：有证据 observed，无证据待观察（绝无数值判定）', () => {
  assert.equal(observationStateFor(['artifact:a']), 'observed');
  assert.equal(observationStateFor([]), 'pending_observation');

  const states = new Set(GROWTH_EVIDENCE_SOURCE_KINDS.map((kind) => observationStateFor([`${kind}:x`])));
  assert.deepEqual([...states], ['observed']);
});

test('来源白名单与契约排序一致（防止契约与服务端漂移）', () => {
  assert.deepEqual([...GROWTH_EVIDENCE_SOURCE_KINDS], [
    'student_answer',
    'theory_check',
    'artifact',
    'reflection',
    'help_request',
  ]);
});
