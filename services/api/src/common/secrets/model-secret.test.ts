import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptModelSecret,
  encryptModelSecret,
  fingerprintModelSecret,
  ModelSecretError,
  MODEL_SECRET_KEY_ENV,
  parseModelSecretKey,
  readModelSecretKey,
} from './model-secret';

/**
 * `model-secret` 的纯函数单测。
 *
 * 仓库尚无 TS 测试运行器，本地编译后运行：
 *
 *   cd services/api
 *   npx tsc -p tsconfig.json --outDir /tmp/qitu-secrets
 *   node --test /tmp/qitu-secrets/common/secrets/model-secret.test.js
 */

const HEX_KEY = 'a'.repeat(64);
const KEY = Buffer.from(HEX_KEY, 'hex');

test('parseModelSecretKey：64 位十六进制解析为 32 字节', () => {
  const parsed = parseModelSecretKey(HEX_KEY);
  assert.equal(parsed?.length, 32);
  assert.deepEqual(parsed, KEY);
});

test('parseModelSecretKey：base64 解析为 32 字节', () => {
  const base64 = Buffer.alloc(32, 7).toString('base64');
  assert.deepEqual(parseModelSecretKey(base64), Buffer.alloc(32, 7));
});

test('parseModelSecretKey：未配置返回 null', () => {
  assert.equal(parseModelSecretKey(undefined), null);
  assert.equal(parseModelSecretKey(''), null);
  assert.equal(parseModelSecretKey('   '), null);
});

test('parseModelSecretKey：长度不对抛 ModelSecretError', () => {
  assert.throws(() => parseModelSecretKey('abc'), ModelSecretError);
  assert.throws(() => parseModelSecretKey(Buffer.alloc(16).toString('base64')), ModelSecretError);
});

test('readModelSecretKey：只读环境变量名，未配置返回 null', () => {
  assert.equal(readModelSecretKey({}), null);
  assert.deepEqual(readModelSecretKey({ [MODEL_SECRET_KEY_ENV]: HEX_KEY }), KEY);
});

test('加解密往返：明文可还原', () => {
  const plaintext = 'sk-live-秘密-123';
  const ciphertext = encryptModelSecret(plaintext, KEY);
  assert.match(ciphertext, /^v1:/);
  assert.ok(!ciphertext.includes(plaintext), '密文不得包含明文');
  assert.equal(decryptModelSecret(ciphertext, KEY), plaintext);
});

test('密文带随机 iv：同一明文两次加密结果不同，但都能解密', () => {
  const a = encryptModelSecret('same', KEY);
  const b = encryptModelSecret('same', KEY);
  assert.notEqual(a, b);
  assert.equal(decryptModelSecret(a, KEY), 'same');
  assert.equal(decryptModelSecret(b, KEY), 'same');
});

test('主密钥不匹配时解密抛错，不返回脏数据', () => {
  const ciphertext = encryptModelSecret('secret', KEY);
  const otherKey = Buffer.alloc(32, 9);
  assert.throws(() => decryptModelSecret(ciphertext, otherKey), ModelSecretError);
});

test('密文被篡改时认证失败并抛错', () => {
  const ciphertext = encryptModelSecret('secret', KEY);
  const parts = ciphertext.split(':');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptModelSecret(parts.join(':'), KEY), ModelSecretError);
});

test('密文格式不认识时抛 ModelSecretError', () => {
  assert.throws(() => decryptModelSecret('not-a-ciphertext', KEY), ModelSecretError);
  assert.throws(() => decryptModelSecret('v2:a:b:c', KEY), ModelSecretError);
});

test('fingerprintModelSecret：稳定、定长、不泄露明文', () => {
  const fp = fingerprintModelSecret('sk-abc');
  assert.equal(fp, fingerprintModelSecret('sk-abc'));
  assert.equal(fp.length, 12);
  assert.notEqual(fp, fingerprintModelSecret('sk-abd'));
});
