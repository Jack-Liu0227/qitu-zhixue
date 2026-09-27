-- Rollback for 0001_cheerful_colossus.sql
-- Run these statements in reverse order to undo the migration.
-- Forward-only in production: review before running in a controlled environment.

DROP INDEX IF EXISTS "idempotency_keys_expires_at_idx";
DROP INDEX IF EXISTS "idempotency_keys_scope_key_idx";

ALTER TABLE "outbox" DROP COLUMN IF EXISTS "last_error";

DROP TABLE IF EXISTS "idempotency_keys";
