import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashIdempotentInput, hashRequest, stableStringify } from './idempotency.hash';

/**
 * `idempotency.hash` 的纯函数单测。
 *
 * 仓库尚未接入 TS 测试运行器（`pnpm test` 仍是占位脚本），本地可临时编译后运行：
 *
 *   cd services/api
 *   npx tsc -p tsconfig.json --outDir /tmp/qitu-idem
 *   node --test /tmp/qitu-idem/common/idempotency/idempotency.hash.test.js
 */

test('stableStringify：对象键顺序不影响结果', () => {
  assert.equal(
    stableStringify({ b: 2, a: 1, c: { z: 1, y: 2 } }),
    stableStringify({ a: 1, c: { y: 2, z: 1 }, b: 2 }),
  );
});

test('stableStringify：数组顺序是语义的一部分，不排序', () => {
  assert.notEqual(stableStringify([1, 2, 3]), stableStringify([3, 2, 1]));
});

test('stableStringify：对象里的 undefined 被忽略，数组里的 undefined 变 null', () => {
  assert.equal(stableStringify({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(stableStringify([1, undefined, 3]), '[1,null,3]');
});

test('stableStringify：Date 输出 ISO 字符串，BigInt 输出十进制字符串', () => {
  assert.equal(stableStringify(new Date('2026-01-02T03:04:05.000Z')), '"2026-01-02T03:04:05.000Z"');
  assert.equal(stableStringify(10n), '"10"');
});

test('stableStringify：循环引用降级为 null，不炸栈', () => {
  const cyclic: Record<string, unknown> = { name: 'x' };
  cyclic.self = cyclic;
  assert.equal(stableStringify(cyclic), '{"name":"x","self":null}');
});

test('hashRequest：同 key 同 payload（仅键顺序不同）得到同一指纹', () => {
  assert.equal(
    hashRequest({ title: 't', stage: 'idea' }),
    hashRequest({ stage: 'idea', title: 't' }),
  );
});

test('hashRequest：payload 不同则指纹不同（用于 IDEMPOTENCY_CONFLICT 判定）', () => {
  assert.notEqual(
    hashRequest({ title: 't', stage: 'idea' }),
    hashRequest({ title: 't', stage: 'practice' }),
  );
});

test('hashRequest：稳定输出 64 位十六进制 sha256', () => {
  const digest = hashRequest({ a: 1 });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, hashRequest({ a: 1 }));
});

test('hashIdempotentInput：路径参数不同则指纹不同', () => {
  assert.notEqual(
    hashIdempotentInput('POST /projects/:id/tasks', { id: 'p1' }, { title: 'x' }),
    hashIdempotentInput('POST /projects/:id/tasks', { id: 'p2' }, { title: 'x' }),
  );
});

test('hashIdempotentInput：scope 不同则指纹不同', () => {
  assert.notEqual(
    hashIdempotentInput('POST /projects', {}, { title: 'x' }),
    hashIdempotentInput('POST /tasks', {}, { title: 'x' }),
  );
});
