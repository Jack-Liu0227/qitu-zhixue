/** Request identity only; this value is never an authentication credential. */
export function createIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
  // getRandomValues is also available on HTTP origins where randomUUID is absent.
  if (typeof cryptoRef?.getRandomValues === 'function') {
    return Array.from(cryptoRef.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
