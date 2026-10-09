-- Remove the public consultation intake table added by the forward migration.
-- The index is explicit so rollback remains valid even when PostgreSQL does not
-- implicitly report dependent index cleanup.
--
-- Dropping this table discards visitor contact leads. If the site is still
-- collecting them, export the rows first; the forward migration can re-create the
-- table but cannot restore the data.
DROP INDEX IF EXISTS "consultation_requests_status_idx";
DROP INDEX IF EXISTS "consultation_requests_idempotency_key_idx";
DROP TABLE IF EXISTS "consultation_requests";
