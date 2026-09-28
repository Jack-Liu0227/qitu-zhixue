-- 0008_domain_foundation 的回滚说明（人工评审后在受控环境执行）。
-- 迁移只前向；本文件仅用于回滚，不对空库重放。
--
-- 顺序：先解除对既有表的增量（外键 / 列），再按依赖倒序删除新表。

-- 1. 解除既有表（users / projects / exploration_sessions）上的增量
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_template_version_id_project_template_versions_id_fk";
ALTER TABLE "exploration_sessions" DROP CONSTRAINT IF EXISTS "exploration_sessions_template_version_id_fk";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_school_id_schools_id_fk";
DROP INDEX IF EXISTS "users_school_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "school_id";

-- 2. 删除新表索引（表删除会级联索引，这里显式列出便于回滚评审）
DROP INDEX IF EXISTS "mastery_attempts_student_objective_idx";
DROP INDEX IF EXISTS "mastery_attempts_student_created_idx";
DROP INDEX IF EXISTS "mastery_records_student_objective_unique_idx";
DROP INDEX IF EXISTS "mastery_records_student_status_idx";
DROP INDEX IF EXISTS "mastery_records_next_review_idx";
DROP INDEX IF EXISTS "learning_sessions_plan_index_unique_idx";
DROP INDEX IF EXISTS "learning_sessions_module_idx";
DROP INDEX IF EXISTS "learning_objectives_module_ordinal_unique_idx";
DROP INDEX IF EXISTS "learning_objectives_module_idx";
DROP INDEX IF EXISTS "learning_modules_plan_ordinal_unique_idx";
DROP INDEX IF EXISTS "learning_modules_plan_idx";
DROP INDEX IF EXISTS "learning_plans_idempotency_unique_idx";
DROP INDEX IF EXISTS "learning_plans_student_status_idx";
DROP INDEX IF EXISTS "learning_plans_project_idx";
DROP INDEX IF EXISTS "mentor_reviews_idempotency_unique_idx";
DROP INDEX IF EXISTS "mentor_reviews_mentor_status_idx";
DROP INDEX IF EXISTS "mentor_reviews_student_idx";
DROP INDEX IF EXISTS "mentor_reviews_project_idx";
DROP INDEX IF EXISTS "knowledge_chunks_document_ordinal_unique_idx";
DROP INDEX IF EXISTS "knowledge_chunks_document_idx";
DROP INDEX IF EXISTS "knowledge_documents_scope_idx";
DROP INDEX IF EXISTS "knowledge_documents_project_idx";
DROP INDEX IF EXISTS "knowledge_documents_owner_idx";
DROP INDEX IF EXISTS "knowledge_documents_status_idx";
DROP INDEX IF EXISTS "student_memories_idempotency_unique_idx";
DROP INDEX IF EXISTS "student_memories_student_idx";
DROP INDEX IF EXISTS "student_memories_updated_idx";
DROP INDEX IF EXISTS "growth_records_idempotency_unique_idx";
DROP INDEX IF EXISTS "growth_records_student_occurred_idx";
DROP INDEX IF EXISTS "growth_records_project_idx";
DROP INDEX IF EXISTS "growth_records_type_idx";
DROP INDEX IF EXISTS "project_template_versions_template_version_unique_idx";
DROP INDEX IF EXISTS "project_template_versions_template_idx";
DROP INDEX IF EXISTS "project_template_versions_status_idx";
DROP INDEX IF EXISTS "project_templates_platform_slug_unique_idx";
DROP INDEX IF EXISTS "project_templates_school_slug_unique_idx";
DROP INDEX IF EXISTS "project_templates_school_idx";
DROP INDEX IF EXISTS "project_templates_status_idx";
DROP INDEX IF EXISTS "schools_code_unique_idx";
DROP INDEX IF EXISTS "schools_status_idx";

-- 3. 删除新表（子表先删，父表后删）
DROP TABLE IF EXISTS "mastery_attempts";
DROP TABLE IF EXISTS "mastery_records";
DROP TABLE IF EXISTS "learning_sessions";
DROP TABLE IF EXISTS "learning_objectives";
DROP TABLE IF EXISTS "learning_modules";
DROP TABLE IF EXISTS "learning_plans";
DROP TABLE IF EXISTS "mentor_reviews";
DROP TABLE IF EXISTS "knowledge_chunks";
DROP TABLE IF EXISTS "knowledge_documents";
DROP TABLE IF EXISTS "student_memories";
DROP TABLE IF EXISTS "growth_records";
DROP TABLE IF EXISTS "project_template_versions";
DROP TABLE IF EXISTS "project_templates";
DROP TABLE IF EXISTS "schools";
