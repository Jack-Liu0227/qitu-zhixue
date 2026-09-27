import { pgTable, text, timestamp, jsonb, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';

/**
 * Idempotency keys: durable record for write operations that accept an
 * `Idempotency-Key` header (project / task / artifact / mentor assignment /
 * intervention writes).
 *
 * Contract:
 * - `(scope, key)` is unique. `scope` is the operation identity
 *   (e.g. `POST /api/v1/projects`); the same client key may therefore be reused
 *   across different operations without colliding.
 * - `request_hash` stores a stable hash of the canonical request, so a replay of
 *   the same key with a different payload can be rejected as a conflict instead
 *   of silently returning the wrong result.
 * - `status` + `response_status` / `response_body` capture the stored outcome,
 *   so a replay can return the original response rather than re-executing the
 *   side effect. `status` is a text enum: `'in_progress' | 'succeeded' | 'failed'`.
 * - `expires_at` bounds retention; rows past expiry are eligible for cleanup.
 *   This table intentionally has no FK to business tables — it is cross-cutting.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    // The core dedup constraint: one stored outcome per (scope, key).
    scopeKeyUniqueIdx: uniqueIndex('idempotency_keys_scope_key_idx').on(table.scope, table.key),
    // Supports retention sweeps of expired rows.
    expiresAtIdx: index('idempotency_keys_expires_at_idx').on(table.expiresAt),
  }),
);
