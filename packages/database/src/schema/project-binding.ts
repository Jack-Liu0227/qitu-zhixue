import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { adminAssistants, adminTeams } from './admin-ai-config';
import { projects } from './projects';
import { projectTemplateVersions } from './project-templates';
import { users } from './identity';

/**
 * F2 / F3：模板版本 ↔ 团队版本绑定 + 项目创建时冻结的绑定快照。
 *
 * 与迁移 `0032_pbl_template_team_bindings` 逐列一致。三张表均不可原地改写：
 * - `admin_team_versions`：团队不可变快照（绑定引用版本而非可变的 `admin_teams` 行）；
 * - `pbl_template_team_bindings`：状态机 `draft → validated → active → retired`；
 * - `project_binding_snapshots`：正式完整快照不可覆盖；旧回填或缺摘要快照仅可经审计修复命令重新确认。
 */

/** 服务端计算的绑定校验结果。`checkedAt` 为 null 表示尚未校验。 */
export interface PblBindingValidationShape {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: string | null;
}

/** 团队不可变版本快照。 */
export const adminTeamVersions = pgTable(
  'admin_team_versions',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => adminTeams.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    workspaceMode: text('workspace_mode').notNull().default('shared'),
    sessionMode: text('session_mode').notNull().default('supervised'),
    leaderAssistantId: text('leader_assistant_id')
      .notNull()
      .references(() => adminAssistants.id, { onDelete: 'restrict' }),
    members: jsonb('members')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    pblSpec: jsonb('pbl_spec')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamVersionUniqueIdx: uniqueIndex('admin_team_versions_team_version_unique_idx').on(
      table.teamId,
      table.version,
    ),
  }),
);

/** 模板版本与团队版本的绑定。 */
export const pblTemplateTeamBindings = pgTable(
  'pbl_template_team_bindings',
  {
    id: text('id').primaryKey(),
    templateVersionId: text('template_version_id')
      .notNull()
      .references(() => projectTemplateVersions.id, { onDelete: 'restrict' }),
    teamVersionId: text('team_version_id')
      .notNull()
      .references(() => adminTeamVersions.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('draft'),
    bindingHash: text('binding_hash').notNull(),
    bundleDigest: text('bundle_digest'),
    bundleDraft: jsonb('bundle_draft').$type<Record<string, unknown> | null>(),
    bundlePayload: jsonb('bundle_payload').$type<Record<string, unknown> | null>(),
    validation: jsonb('validation')
      .$type<PblBindingValidationShape>()
      .notNull()
      .default(sql`'{"valid":false,"errors":[],"warnings":[],"checkedAt":null}'::jsonb`),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // 局部唯一索引：一个模板版本同一时刻最多一个 active 绑定（并发双激活兜底）。
    oneActivePerTemplateIdx: uniqueIndex('pbl_template_team_bindings_one_active_per_template_idx')
      .on(table.templateVersionId)
      .where(sql`${table.status} = 'active'`),
    templateStatusIdx: index('pbl_template_team_bindings_template_status_idx').on(
      table.templateVersionId,
      table.status,
    ),
    teamVersionIdx: index('pbl_template_team_bindings_team_version_idx').on(table.teamVersionId),
  }),
);

/** 项目创建时冻结的绑定快照（不可变，只读）。 */
export const projectBindingSnapshots = pgTable('project_binding_snapshots', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'restrict' }),
  templateVersionId: text('template_version_id')
    .notNull()
    .references(() => projectTemplateVersions.id, { onDelete: 'restrict' }),
  bindingId: text('binding_id')
    .notNull()
    .references(() => pblTemplateTeamBindings.id, { onDelete: 'restrict' }),
  teamVersionId: text('team_version_id')
    .notNull()
    .references(() => adminTeamVersions.id, { onDelete: 'restrict' }),
  bindingHash: text('binding_hash').notNull(),
  bundleDigest: text('bundle_digest'),
  boundAt: timestamp('bound_at', { withTimezone: true }).notNull(),
  backfilled: boolean('backfilled').notNull().default(false),
});
