-- T21（Lead 核实的时序死锁修复·数据层地基）：PBL 门禁「待冲刷证据账本」。
--
-- 背景：T14 的 recordGateForStudent 在无活跃 team run 时返回 skipped 且不留痕。
-- 真实产品顺序是「学生先确认意图 / 先掌握理论 / 先复核通过作品，之后才第一次
-- 进入 AI 搭档团队链路」，导致门禁事件永不产生、advancePhase 永久 409。
--
-- 本表是**服务端私有**账本：域服务（projects / mastery / works）在业务成功时
-- 直接落一行，完全不感知 run；T22 的 startRun 冲刷逻辑建 run 后把
-- consumed_at IS NULL 的行物化为 team.gate.satisfied 事件并回写 consumed_*。
-- 不开放任何客户端读写路径（AGENTS.md：门禁证据不可由客户端写入）。
--
-- 唯一索引 (student_user_id, gate, evidence_ref) 是幂等写入的核心：
-- 同一学生同一门禁同一证据只有一行，域侧用 ON CONFLICT DO NOTHING 重放安全。
-- 冲刷查询走 (student_user_id, consumed_at)（未冲刷 = consumed_at IS NULL）。
--
-- 可重复执行（rolling deployment 安全）：全部 IF NOT EXISTS。
CREATE TABLE IF NOT EXISTS "pbl_gate_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "student_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "gate" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "consumed_run_id" text,
  "consumed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "pbl_gate_evidence_student_gate_ref_unique_idx" ON "pbl_gate_evidence" ("student_user_id", "gate", "evidence_ref");
CREATE INDEX IF NOT EXISTS "pbl_gate_evidence_student_pending_idx" ON "pbl_gate_evidence" ("student_user_id", "consumed_at");
