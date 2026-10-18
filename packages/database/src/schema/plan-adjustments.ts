import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { learningPlans } from './learning-plan';
import { projects } from './projects';

/**
 * Project plan adjustments: 宏观调谐（计划调整）记录（api-spec F4）。
 *
 * Append-only 账本：一行就是一次已提交的计划调整。客户端不可写；唯一写入方是
 * 服务端 `PlanAdjustmentService`（在 `StuckSignalService` 的卡点链路里触发）。
 *
 * 幂等 / 不变量：
 * - `UNIQUE (project_id, idempotency_key)`：同源触发只落一行，重放安全；
 * - `UNIQUE (trigger_key)`：卡点信号按节点级触发键去重，first crossing 才建行；
 * - `UNIQUE (project_id, base_revision, next_revision) WHERE action='append_optional_remediation'`：
 *   revision 链唯一。只对 append 生效，因为 recommend 不改 outline（next = base），
 *   多个 recommend 会撞全局唯一键，故用 partial 索引。
 * - `remediation_payload` 只在 append 动作下非空，保存追加的补救节点
 *   （isRemedial、prerequisite=stem node）；recommend 动作永远为 NULL。
 *
 * `base_revision` / `next_revision` 直接映射 `learning_plans.version`（计划乐观锁
 * 修订号；`plan_outline` 无持久化表，revision 以计划行为真源）。apply 时
 * `next_revision = base_revision + 1`。
 */
export const projectPlanAdjustments = pgTable(
  'project_plan_adjustments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    planId: text('plan_id')
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'restrict' }),
    /** 卡点所在的计划大纲节点（`learning_objectives.id`，不加 FK：节点是业务引用）。 */
    stemNodeId: text('stem_node_id').notNull(),
    /** 乐观锁：必须等于提交时的 `learning_plans.version`。 */
    baseRevision: integer('base_revision').notNull(),
    /** apply 时恒为 `base_revision + 1`；recommend 时等于 base。 */
    nextRevision: integer('next_revision').notNull(),
    trigger: text('trigger').notNull(),
    evidenceRefs: jsonb('evidence_refs')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    action: text('action').notNull(),
    status: text('status').notNull(),
    policyVersion: text('policy_version').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    /** 同一 stem node 上已 applied 的补救节点数（熔断器入参）。 */
    remedialDepth: integer('remedial_depth').notNull().default(0),
    remediationPayload: jsonb('remediation_payload').$type<Record<string, unknown> | null>(),
    /** 节点级触发键（`misconception:...` / `l3_cap:...` 等），全局唯一。 */
    triggerKey: text('trigger_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectKeyUniqueIdx: uniqueIndex('project_plan_adjustments_project_key_unique_idx').on(
      table.projectId,
      table.idempotencyKey,
    ),
    triggerKeyUniqueIdx: uniqueIndex('project_plan_adjustments_trigger_key_unique_idx').on(
      table.triggerKey,
    ),
    revisionChainUniqueIdx: uniqueIndex(
      'project_plan_adjustments_revision_chain_unique_idx',
    )
      .on(table.projectId, table.baseRevision, table.nextRevision)
      .where(sql`${table.action} = 'append_optional_remediation'`),
    projectStatusIdx: index('project_plan_adjustments_project_status_idx').on(
      table.projectId,
      table.status,
    ),
    stemNodeIdx: index('project_plan_adjustments_stem_node_idx').on(
      table.projectId,
      table.stemNodeId,
    ),
  }),
);
