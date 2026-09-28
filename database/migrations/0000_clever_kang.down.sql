-- Rollback for 0000_clever_kang.sql
-- Run these statements in reverse order to undo the migration

DROP INDEX IF EXISTS "outbox_created_at_idx";
DROP INDEX IF EXISTS "outbox_status_idx";
DROP INDEX IF EXISTS "audit_logs_at_idx";
DROP INDEX IF EXISTS "audit_logs_target_idx";
DROP INDEX IF EXISTS "audit_logs_actor_idx";
DROP INDEX IF EXISTS "audit_logs_idempotency_key_idx";
DROP INDEX IF EXISTS "users_email_lower_idx";
DROP INDEX IF EXISTS "mentor_assignments_mentor_idx";
DROP INDEX IF EXISTS "mentor_assignments_one_active_per_student_idx";
DROP INDEX IF EXISTS "guardian_links_student_idx";
DROP INDEX IF EXISTS "guardian_links_active_unique_idx";

DROP TABLE IF EXISTS "outbox";
DROP TABLE IF EXISTS "audit_logs";
DROP TABLE IF EXISTS "mentor_assignments";
DROP TABLE IF EXISTS "guardian_links";
DROP TABLE IF EXISTS "households";
DROP TABLE IF EXISTS "users";
