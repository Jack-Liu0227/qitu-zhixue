import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  normaliseApi,
  normaliseEnabled,
  normaliseModalities,
  normaliseOptionalInt,
  requireDisplayName,
  requireModelId,
  resolveIdempotencyKey,
} from './manual-model.validation';

/**
 * 手工模型校验纯函数单测：不需要数据库，任何环境都能跑。
 *
 * 重点是「宁可少声明能力，也不猜」以及「幂等键绝不静默为空」。
 */

test('requireModelId / requireDisplayName：去空白、拦空、拦超长', () => {
  assert.equal(requireModelId('  qwen-max  '), 'qwen-max');
  assert.equal(requireDisplayName(' Qwen Max '), 'Qwen Max');

  for (const invalid of [undefined, null, '', '   ', 42, {}]) {
    assert.throws(() => requireModelId(invalid), BadRequestException);
    assert.throws(() => requireDisplayName(invalid), BadRequestException);
  }
  assert.throws(() => requireModelId('x'.repeat(201)), BadRequestException);
  assert.throws(() => requireDisplayName('x'.repeat(201)), BadRequestException);
});

test('normaliseModalities：默认 text、拒绝未知、去重、绝不自动补 audio', () => {
  assert.deepEqual(normaliseModalities(undefined, 'input'), ['text']);
  assert.deepEqual(normaliseModalities([], 'output'), ['text']);
  assert.deepEqual(normaliseModalities(['audio', 'audio', 'text'], 'input'), ['audio', 'text']);
  // 只声明文本时，不因为模型可能支持语音就补 audio。
  assert.deepEqual(normaliseModalities(['text'], 'output'), ['text']);

  assert.throws(() => normaliseModalities(['video'], 'input'), BadRequestException);
  assert.throws(() => normaliseModalities('text', 'input'), BadRequestException);
});

test('normaliseApi：缺省沿用供应商，覆盖必须一致', () => {
  assert.equal(normaliseApi(undefined, 'openai-responses'), 'openai-responses');
  assert.equal(normaliseApi('openai-responses', 'openai-responses'), 'openai-responses');
  assert.throws(() => normaliseApi('anthropic-messages', 'openai-responses'), BadRequestException);
  assert.throws(() => normaliseApi('not-a-protocol', 'openai-completions'), BadRequestException);
});

test('normaliseOptionalInt / normaliseEnabled：范围与时默认值', () => {
  assert.equal(normaliseOptionalInt(undefined, 'contextWindow'), null);
  assert.equal(normaliseOptionalInt(null, 'maxTokens'), null);
  assert.equal(normaliseOptionalInt(128000, 'contextWindow'), 128000);
  for (const invalid of [0, -1, 1.5, '8']) {
    assert.throws(() => normaliseOptionalInt(invalid, 'contextWindow'), BadRequestException);
  }

  assert.equal(normaliseEnabled(undefined, true), true);
  assert.equal(normaliseEnabled(undefined, false), false);
  assert.equal(normaliseEnabled(false, true), false);
  assert.throws(() => normaliseEnabled('yes', true), BadRequestException);
});

test('resolveIdempotencyKey：头部优先、二者一致可、拒绝空与不一致', () => {
  assert.equal(resolveIdempotencyKey('key-1', undefined), 'key-1');
  assert.equal(resolveIdempotencyKey(undefined, 'key-2'), 'key-2');
  assert.equal(resolveIdempotencyKey('same', 'same'), 'same');
  assert.equal(resolveIdempotencyKey('  spaced  ', undefined), 'spaced');

  assert.throws(() => resolveIdempotencyKey('a', 'b'), BadRequestException);
  for (const empty of [undefined, null, '', '   ']) {
    assert.throws(() => resolveIdempotencyKey(empty, empty), BadRequestException);
  }
});
