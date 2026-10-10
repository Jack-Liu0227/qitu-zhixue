-- Rollback of 0022_pbl_gate_evidence.
-- 按依赖逆序：先删索引，再删表。纯新增表，回滚不影响任何既有数据。
-- 全部 IF EXISTS，可重复执行。
DROP INDEX IF EXISTS "pbl_gate_evidence_student_pending_idx";
DROP INDEX IF EXISTS "pbl_gate_evidence_student_gate_ref_unique_idx";
DROP TABLE IF EXISTS "pbl_gate_evidence";
