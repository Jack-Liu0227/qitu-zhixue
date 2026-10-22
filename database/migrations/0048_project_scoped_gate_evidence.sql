-- Existing unscoped rows remain historical; never infer a project from a student's current run.
ALTER TABLE pbl_gate_evidence ADD COLUMN project_id text REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX pbl_gate_evidence_project_pending_idx ON pbl_gate_evidence(project_id, consumed_at);
