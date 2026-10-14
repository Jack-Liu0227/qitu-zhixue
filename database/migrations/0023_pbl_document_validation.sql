-- P2（WS3）：确定性证据生产者留痕两张表。
--
-- 背景：门禁事件（team.gate.satisfied）只能由服务端确定性规则写；AI 评估方只产出
-- **候选**。本迁移提供两张**纯新增**表，把「候选」与「校验结论」留痕：
--
-- 1. work_assessment_candidates —— AI 候选（分数 + 逐条 criterion 理由）。
--    - source='ai' 且 status/state 由服务端构造；本表**不代表通过**；
--    - candidate_key 唯一：同一项目/版本/rubric 只留一个候选（ON CONFLICT DO NOTHING）。
--
-- 2. work_validation_checks —— 确定性校验结论行（文档结构 / 视频合规 / 代码静态）。
--    - validator_version + sha256 使「查了什么」可追溯；
--    - check_key 唯一：同一份字节同一校验器版本只留一行；
--    - 只存结构化结论，**不存**媒体内容、报告正文、转写文本。
--
-- 迁移原则（与 0022 一致）：
-- - 纯新增，全部 IF NOT EXISTS，可重复执行（rolling deployment 安全）；
-- - **不动** project_evidence 既有的 (project_id, column_kind, source_kind, source_id)
--   唯一索引——那是证据物化的幂等基石，改动它会破坏重放语义；
-- - 不回填、不改写任何既有行。
CREATE TABLE IF NOT EXISTS "work_assessment_candidates" (
  "id" text PRIMARY KEY NOT NULL,
  "school_id" text REFERENCES "schools"("id") ON DELETE RESTRICT,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "student_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "artifact_id" text NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "artifact_version_id" text NOT NULL REFERENCES "artifact_versions"("id") ON DELETE CASCADE,
  "rubric_id" text NOT NULL,
  "rubric_version" text NOT NULL,
  "source" text NOT NULL,
  "model_id" text,
  "status" text NOT NULL,
  "state" text NOT NULL,
  "score" integer,
  "criteria" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "missing_evidence_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "evidence_ref" text,
  "accepted_at" timestamptz,
  "accepted_by_rule" text,
  "candidate_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_assessment_candidates_key_unique_idx" ON "work_assessment_candidates" ("candidate_key");
CREATE INDEX IF NOT EXISTS "work_assessment_candidates_project_idx" ON "work_assessment_candidates" ("project_id");
CREATE INDEX IF NOT EXISTS "work_assessment_candidates_student_state_idx" ON "work_assessment_candidates" ("student_user_id", "state");
CREATE INDEX IF NOT EXISTS "work_assessment_candidates_version_idx" ON "work_assessment_candidates" ("artifact_version_id");

CREATE TABLE IF NOT EXISTS "work_validation_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "school_id" text REFERENCES "schools"("id") ON DELETE RESTRICT,
  "project_id" text REFERENCES "projects"("id") ON DELETE CASCADE,
  "student_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "artifact_id" text REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "artifact_version_id" text NOT NULL REFERENCES "artifact_versions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "validator_version" text NOT NULL,
  "sha256" text,
  "verdict" text NOT NULL,
  "findings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "check_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_validation_checks_key_unique_idx" ON "work_validation_checks" ("check_key");
CREATE INDEX IF NOT EXISTS "work_validation_checks_version_kind_idx" ON "work_validation_checks" ("artifact_version_id", "kind");
CREATE INDEX IF NOT EXISTS "work_validation_checks_project_kind_idx" ON "work_validation_checks" ("project_id", "kind");
