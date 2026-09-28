-- Rollback for 0003_glamorous_ulik.sql
-- Run these statements in reverse order to undo the migration.
-- Forward-only in production: review before running in a controlled environment.

DROP INDEX IF EXISTS "parent_growth_exports_expires_at_idx";
DROP INDEX IF EXISTS "parent_growth_exports_child_idx";
DROP INDEX IF EXISTS "parent_growth_exports_parent_idx";

-- Dropping the table also drops its FK constraints.
DROP TABLE IF EXISTS "parent_growth_exports";
