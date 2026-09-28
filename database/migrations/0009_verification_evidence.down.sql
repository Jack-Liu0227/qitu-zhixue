-- 0009_verification_evidence 的回滚说明（人工评审后在受控环境执行）。
-- 迁移只前向；本文件仅用于回滚，不对空库重放。
--
-- 本迁移为**纯增量**：只新增验证 / 作品 / 项目证据 / 待答题表，不改动任何既有表。
-- 顺序：先删依赖方（子表 / 证据行），再删被依赖表。

-- 1. 删除子表索引（表删除会级联索引，这里显式列出便于回滚评审）
DROP INDEX IF EXISTS "template_verification_evidence_ref_unique_idx";
DROP INDEX IF EXISTS "template_verification_evidence_run_idx";
DROP INDEX IF EXISTS "template_verification_evidence_source_idx";
DROP INDEX IF EXISTS "template_verification_evidence_school_idx";
DROP INDEX IF EXISTS "template_verification_runs_idempotency_unique_idx";
DROP INDEX IF EXISTS "template_verification_runs_version_evaluated_idx";
DROP INDEX IF EXISTS "template_verification_runs_passed_idx";
DROP INDEX IF EXISTS "template_verification_runs_school_idx";
DROP INDEX IF EXISTS "artifact_versions_artifact_ordinal_unique_idx";
DROP INDEX IF EXISTS "artifact_versions_artifact_idx";
DROP INDEX IF EXISTS "artifacts_idempotency_unique_idx";
DROP INDEX IF EXISTS "artifacts_student_status_idx";
DROP INDEX IF EXISTS "artifacts_project_idx";
DROP INDEX IF EXISTS "artifacts_visibility_idx";
DROP INDEX IF EXISTS "project_evidence_fact_unique_idx";
DROP INDEX IF EXISTS "project_evidence_project_column_idx";
DROP INDEX IF EXISTS "project_evidence_student_idx";
DROP INDEX IF EXISTS "project_evidence_source_idx";
DROP INDEX IF EXISTS "pending_questions_idempotency_unique_idx";
DROP INDEX IF EXISTS "pending_questions_awaiting_unique_idx";
DROP INDEX IF EXISTS "pending_questions_student_status_idx";
DROP INDEX IF EXISTS "pending_questions_plan_idx";
DROP INDEX IF EXISTS "pending_questions_session_idx";
DROP INDEX IF EXISTS "pending_questions_objective_idx";

-- 2. 删除新表（依赖方先删，被依赖表后删）
DROP TABLE IF EXISTS "template_verification_evidence";
DROP TABLE IF EXISTS "template_verification_runs";
DROP TABLE IF EXISTS "project_evidence";
DROP TABLE IF EXISTS "artifact_versions";
DROP TABLE IF EXISTS "artifacts";
DROP TABLE IF EXISTS "pending_questions";
