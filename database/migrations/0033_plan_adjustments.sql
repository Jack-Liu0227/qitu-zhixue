-- F4（宏观调谐·计划调整）：`project_plan_adjustments` append-only 账本。
--
-- 背景：卡点信号（StudentStuckSignal）在事务内 outbox 产生后，由
-- PlanAdjustmentService 在同一事务写入本表 + 学习计划表（追加补救节点），
-- 并用 (project_id, idempotency_key) 唯一索引做节点级幂等；trigger_key 唯一
-- 索引保证同一卡点信号 first crossing 只落一行。
--
-- 乐观锁：base_revision / next_revision 映射 learning_plans.version。
-- 部分唯一索引只约束 append 动作（recommend 不改 outline，next=base，会碰撞）。
--
-- 可重复执行（rolling deployment 安全）：全部 IF NOT EXISTS。
CREATE TABLE IF NOT EXISTS "project_plan_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "plan_id" text NOT NULL REFERENCES "learning_plans"("id") ON DELETE RESTRICT,
  "stem_node_id" text NOT NULL,
  "base_revision" integer NOT NULL,
  "next_revision" integer NOT NULL,
  "trigger" text NOT NULL,
  "evidence_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "action" text NOT NULL,
  "status" text NOT NULL,
  "policy_version" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "remedial_depth" integer NOT NULL DEFAULT 0,
  "remediation_payload" jsonb,
  "trigger_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_plan_adjustments_project_key_unique_idx" ON "project_plan_adjustments" ("project_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "project_plan_adjustments_trigger_key_unique_idx" ON "project_plan_adjustments" ("trigger_key");
CREATE UNIQUE INDEX IF NOT EXISTS "project_plan_adjustments_revision_chain_unique_idx" ON "project_plan_adjustments" ("project_id", "base_revision", "next_revision") WHERE "action" = 'append_optional_remediation';
CREATE INDEX IF NOT EXISTS "project_plan_adjustments_project_status_idx" ON "project_plan_adjustments" ("project_id", "status");
CREATE INDEX IF NOT EXISTS "project_plan_adjustments_stem_node_idx" ON "project_plan_adjustments" ("project_id", "stem_node_id");
