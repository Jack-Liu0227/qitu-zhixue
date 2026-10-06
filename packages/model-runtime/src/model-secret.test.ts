import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  decryptModelRuntimeSecret,
  ModelRuntimeSecretError,
  parseModelRuntimeSecretKey,
} from './model-secret.js';

function encryptFixture(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

test('parseModelRuntimeSecretKey accepts only 32-byte hex/base64 keys', () => {
  const key = Buffer.alloc(32, 7);
  assert.deepEqual(parseModelRuntimeSecretKey(key.toString('hex')), key);
  assert.deepEqual(parseModelRuntimeSecretKey(key.toString('base64')), key);
  assert.equal(parseModelRuntimeSecretKey(undefined), null);
  assert.throws(() => parseModelRuntimeSecretKey('too-short'), ModelRuntimeSecretError);
});

test('decryptModelRuntimeSecret authenticates v1 AES-GCM payloads', () => {
  const key = Buffer.alloc(32, 3);
  const payload = encryptFixture('server-only-provider-key', key);
  assert.equal(decryptModelRuntimeSecret(payload, key), 'server-only-provider-key');

  const parts = payload.split(':');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(
    () => decryptModelRuntimeSecret(parts.join(':'), key),
    ModelRuntimeSecretError,
  );
  assert.throws(
    () => decryptModelRuntimeSecret('v2:a:b:c', key),
    ModelRuntimeSecretError,
  );
});
