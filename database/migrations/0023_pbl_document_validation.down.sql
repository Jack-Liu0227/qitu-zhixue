-- Rollback of 0023_pbl_document_validation.
-- 按依赖逆序删索引、再删表；纯新增表，回滚不影响任何既有数据。
-- 全部 IF EXISTS，可重复执行。
-- 注意：回滚会丢弃「候选留痕」与「校验结论」——门禁事件本身在
-- agent_team_events 里，不受本回滚影响。
DROP INDEX IF EXISTS "work_validation_checks_project_kind_idx";
DROP INDEX IF EXISTS "work_validation_checks_version_kind_idx";
DROP INDEX IF EXISTS "work_validation_checks_key_unique_idx";
DROP TABLE IF EXISTS "work_validation_checks";

DROP INDEX IF EXISTS "work_assessment_candidates_version_idx";
DROP INDEX IF EXISTS "work_assessment_candidates_student_state_idx";
DROP INDEX IF EXISTS "work_assessment_candidates_project_idx";
DROP INDEX IF EXISTS "work_assessment_candidates_key_unique_idx";
DROP TABLE IF EXISTS "work_assessment_candidates";
