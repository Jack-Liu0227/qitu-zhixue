-- Rollback of 0019_admin_ai_config. Child tables first (FK order); the rows are
-- server configuration only — no student data lives in these tables.
DROP TABLE IF EXISTS "admin_team_members";
DROP TABLE IF EXISTS "admin_teams";
DROP TABLE IF EXISTS "admin_assistants";
