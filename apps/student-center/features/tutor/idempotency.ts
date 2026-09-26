/**
 * Client turn keys for idempotent writes.
 *
 * Every create/mutate call on this page (session create, turn submit, feedback)
 * carries a key so a double click or a retry after a dropped socket produces at
 * most one server-side record. Keys are generated in memory only and reused
 * verbatim until the call is acknowledged.
 */
export function createIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto !== undefined && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  // Non-crypto fallback for older runtimes; still unique enough for a
  // short-lived, in-memory client retry key.
  const random = Math.random().toString(36).slice(2);
  return `turn-${Date.now().toString(36)}-${random}`;
}
