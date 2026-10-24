import test from 'node:test';
import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../packages/api-client/src/idempotency.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createIdempotencyKey } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('HTTP browser request keys work without randomUUID and stay distinct', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: bytes => randomFillSync(bytes) } });
    const keys = Array.from({ length: 100 }, createIdempotencyKey);
    assert.equal(new Set(keys).size, 100);
    assert.ok(keys.every(key => /^[0-9a-f]{32}$/.test(key)));
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    const fallback = Array.from({ length: 100 }, createIdempotencyKey);
    assert.equal(new Set(fallback).size, 100);
    assert.ok(fallback.every(key => key.length > 20 && key.length <= 160));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});
