-- F2（独立验证官）：班主任唯一性的数据库层兜底。
-- AGENTS.md 硬约束「一个学生同一时间只能有一个当前班主任」此前仅由
-- team-runtime.service.ts 的 decideMentorUniqueness 做 check-then-insert，
-- 并发两次 startRun 可同时通过检查造成双活跃 run（TOCTOU）。
--
-- 部分唯一索引：同一 student_user_id 只允许一行 status ∈ ('queued','running')。
-- - NULL student_user_id（无学生归属的服务端 run）不受约束：Postgres 唯一索引
--   默认 NULLS DISTINCT，多个 NULL 行可共存，行为与既有链路一致。
-- - 终态（completed/failed/cancelled 等）不在 WHERE 内，历史 run 不受影响。
-- 服务层把该索引的 23505 唯一冲突映射为 409
-- TEAM_MENTOR_UNIQUENESS_CONFLICT（完全匹配 leader+会话+项目时保留幂等重放）。
--
-- 注意：若库中已存在同一学生的多行活跃 run，本索引创建会失败并阻断迁移——
-- 这是有意的（先修数据再升级），不做静默去重。
-- 可重复执行（rolling deployment 安全）。
CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_runs_active_mentor_unique_idx"
  ON "agent_team_runs" ("student_user_id")
  WHERE "status" IN ('queued', 'running');
