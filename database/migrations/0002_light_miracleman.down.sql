-- Rollback for 0002_light_miracleman.sql
-- Run these statements in reverse order to undo the migration.
-- Forward-only in production: review before running in a controlled environment.

DROP INDEX IF EXISTS "model_usage_bindings_provider_model_idx";

-- Drop bindings before models/providers (RESTRICT FKs would otherwise block).
DROP TABLE IF EXISTS "model_usage_bindings";
DROP TABLE IF EXISTS "model_models";
DROP TABLE IF EXISTS "model_providers";
