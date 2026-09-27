import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 模型供应商密钥的**最小**加解密工具（AES-256-GCM）。
 *
 * 背景：
 * - `model_providers.encrypted_api_key` 是唯一的密钥落库位置；明文绝不能进库。
 * - 主密钥只从环境变量 `QITU_MODEL_SECRET_KEY` 读取，**绝不写入仓库 / 迁移 / 日志**。
 * - 缺失主密钥时由调用方（`ModelRegistryService`）抛 503，而不是写明文或假成功。
 *
 * 存储格式（单字段、自带版本与前缀，便于将来轮换算法）：
 *
 * ```text
 *   v1:<iv base64url>:<authTag base64url>:<ciphertext base64url>
 * ```
 *
 * - `iv` 12 字节（GCM 推荐长度），每次加密随机生成；
 * - `authTag` 16 字节，解密时校验，任何篡改都会抛 `ModelSecretError`；
 * - `ciphertext` 为 UTF-8 明文的密文。
 *
 * 本文件是纯函数 + 环境读取，不依赖 Nest / 数据库，便于直接单测。
 */

/** `QITU_MODEL_SECRET_KEY` 的环境变量名（只读，不提供写入 helper）。 */
export const MODEL_SECRET_KEY_ENV = 'QITU_MODEL_SECRET_KEY';

/** AES-256-GCM 主密钥长度（字节）。 */
export const MODEL_SECRET_KEY_BYTES = 32;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 'v1';

/** 密钥 / 密文格式错误。调用方应把它翻译成配置错误（503），绝不能静默降级。 */
export class ModelSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelSecretError';
  }
}

/**
 * 解析主密钥字符串。
 *
 * 接受两种编码，都是 32 字节：
 * - 64 个十六进制字符；
 * - base64 / base64url（解码后必须正好 32 字节）。
 *
 * 返回 `null` 表示**未配置**；格式错误抛 `ModelSecretError`（配置错误要显式暴露，
 * 不能被当成「未配置」而悄悄退回内存/明文）。
 */
export function parseModelSecretKey(raw: string | undefined | null): Buffer | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === MODEL_SECRET_KEY_BYTES) {
    return decoded;
  }

  throw new ModelSecretError(
    `${MODEL_SECRET_KEY_ENV} 必须是 32 字节密钥：64 位十六进制，或 base64 编码的 32 字节值。` +
      ` 生成示例：openssl rand -base64 32`,
  );
}

/** 从环境变量读取主密钥；未配置返回 `null`，格式错误抛错。 */
export function readModelSecretKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  return parseModelSecretKey(env[MODEL_SECRET_KEY_ENV]);
}

/** 加密明文密钥，返回 `v1:iv:tag:ciphertext` 字符串。 */
export function encryptModelSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * 解密 `encryptModelSecret` 的产物。
 *
 * 任何结构错误、版本不符或认证标签校验失败都会抛 `ModelSecretError`。
 */
export function decryptModelSecret(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new ModelSecretError('密钥密文格式不认识（期望 v1:iv:tag:ciphertext）');
  }
  const [, ivPart, tagPart, dataPart] = parts;
  if (ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    throw new ModelSecretError('密钥密文格式不认识（字段缺失）');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const authTag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(dataPart, 'base64url');
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new ModelSecretError('密钥密文格式不认识（iv / authTag 长度不对）');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // 不把底层错误信息带出去（可能夹带密钥材料）。统一为认证失败。
    throw new ModelSecretError('密钥密文认证失败：主密钥不匹配或密文被篡改');
  }
}

/**
 * 密钥指纹：SHA-256 十六进制前 12 位。
 *
 * 与响应 `auth.keyFingerprint` 的历史形状保持一致；指纹不可逆，只用于
 * 「管理员换了没换密钥」的判断，不能当密钥用。
 */
export function fingerprintModelSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

/** 常量时间比较两个密钥（供将来轮换校验使用；不用于指纹展示）。 */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function assertKey(key: Buffer): void {
  if (key.length !== MODEL_SECRET_KEY_BYTES) {
    throw new ModelSecretError(`AES-256-GCM 主密钥必须是 ${MODEL_SECRET_KEY_BYTES} 字节`);
  }
}
