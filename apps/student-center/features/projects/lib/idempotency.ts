/**
 * 生成写操作的 `Idempotency-Key`。
 *
 * 同一次用户提交（含双击/重试）复用同一个 key，服务端据此只落一条记录；
 * 成功后调用方应丢弃并生成新 key。
 */
export function createIdempotencyKey(): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `proj-${Date.now().toString(36)}-${random}`;
}
