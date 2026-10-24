import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './projects';
import { projectTemplateVersions } from './project-templates';
import { users } from './identity';

/** Bindings own frozen teaching teams; projects freeze binding identity and digests. */
export interface PblBindingValidationShape {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: string | null;
}

/** Embedded source configuration. Historical v1 fields remain hash-compatible. */
export interface FrozenTeachingTeam {
  id: string; teamId: string; version: number; name: string; description: string;
  workspaceMode: string; sessionMode: string; leaderAssistantId: string;
  members: unknown[]; pblSpec: Record<string, unknown>; enabled: boolean;
  createdBy: string | null; createdAt: string;
}

/** 模板版本与团队版本的绑定。 */
export const pblTemplateTeamBindings = pgTable(
  'pbl_template_team_bindings',
  {
    id: text('id').primaryKey(),
    templateVersionId: text('template_version_id')
      .notNull()
      .references(() => projectTemplateVersions.id, { onDelete: 'restrict' }),
    teamVersionId: text('team_version_id')
      .notNull(),
    teamSnapshots: jsonb('team_snapshots').$type<Record<string, FrozenTeachingTeam>>().notNull().default(sql`'{}'::jsonb`),
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
    .notNull(),
  bindingHash: text('binding_hash').notNull(),
  bundleDigest: text('bundle_digest'),
  boundAt: timestamp('bound_at', { withTimezone: true }).notNull(),
  backfilled: boolean('backfilled').notNull().default(false),
});
