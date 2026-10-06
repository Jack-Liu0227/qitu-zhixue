import { createDecipheriv } from 'node:crypto';

export class ModelRuntimeSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRuntimeSecretError';
  }
}

/** Parse the server model secret key without accepting short or malformed keys. */
export function parseModelRuntimeSecretKey(raw: string | undefined | null): Buffer | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;
  if (/^[0-9a-fA-F]{64}$/u.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new ModelRuntimeSecretError('模型密钥配置无效');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32 && decoded.toString('base64') === value) return decoded;
  throw new ModelRuntimeSecretError('模型密钥配置无效');
}

/** Decrypt the `v1:iv:authTag:ciphertext` provider secret format. */
export function decryptModelRuntimeSecret(payload: string, key: Buffer): string {
  if (key.length !== 32) throw new ModelRuntimeSecretError('模型密钥配置无效');
  const parts = payload.split(':');
  const ivPart = parts[1];
  const tagPart = parts[2];
  const dataPart = parts[3];
  if (parts.length !== 4 || parts[0] !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new ModelRuntimeSecretError('模型密文格式无效');
  }
  const iv = decodeBase64Url(ivPart);
  const authTag = decodeBase64Url(tagPart);
  const ciphertext = decodeBase64Url(dataPart);
  if (iv.length !== 12 || authTag.length !== 16) throw new ModelRuntimeSecretError('模型密文格式无效');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new ModelRuntimeSecretError('模型密文认证失败');
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(value) || value.length % 4 === 1) {
    throw new ModelRuntimeSecretError('模型密文格式无效');
  }
  const normalized = value.replace(/=+$/u, '');
  const decoded = Buffer.from(normalized, 'base64url');
  if (decoded.toString('base64url') !== normalized) {
    throw new ModelRuntimeSecretError('模型密文格式无效');
  }
  return decoded;
}
