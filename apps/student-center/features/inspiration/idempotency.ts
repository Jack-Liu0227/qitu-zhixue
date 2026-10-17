import { createIdempotencyKey } from '../tutor/idempotency';

/** In-memory key reused across retries of one recommended exploration click. */
export function createInspirationIdempotencyKey(): string {
  return createIdempotencyKey();
}
