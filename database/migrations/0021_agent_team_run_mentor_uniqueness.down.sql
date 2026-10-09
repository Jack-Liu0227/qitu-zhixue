-- Rollback of 0021_agent_team_run_mentor_uniqueness.
-- 只移除兜底索引；agent_team_runs 表与数据保持不变（与既有 down 文件风格一致，
-- 回滚后唯一性回到仅应用层 check-then-insert 的旧行为）。
DROP INDEX IF EXISTS "agent_team_runs_active_mentor_unique_idx";
