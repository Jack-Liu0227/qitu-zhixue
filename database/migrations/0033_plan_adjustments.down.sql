-- Rollback of 0033_plan_adjustments.
-- 按依赖逆序：先删索引，再删表。纯新增表，回滚不影响任何既有数据。
-- 全部 IF EXISTS，可重复执行。
DROP INDEX IF EXISTS "project_plan_adjustments_stem_node_idx";
DROP INDEX IF EXISTS "project_plan_adjustments_project_status_idx";
DROP INDEX IF EXISTS "project_plan_adjustments_revision_chain_unique_idx";
DROP INDEX IF EXISTS "project_plan_adjustments_trigger_key_unique_idx";
DROP INDEX IF EXISTS "project_plan_adjustments_project_key_unique_idx";
DROP TABLE IF EXISTS "project_plan_adjustments";
