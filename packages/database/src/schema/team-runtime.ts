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
import { agentConfigs } from './agent-runtime';
import { users } from './identity';
import { projects } from './projects';

/**
 * Durable Team Runtime state.
 *
 * The tutor is the team leader. Child agents never write domain records from
 * this state machine; they return task results which are consumed by the
 * owning domain service. All JSON fields are server-owned snapshots and are
 * deliberately kept separate from the student-facing conversation tables.
 */
export const agentTeamRuns = pgTable(
  'agent_team_runs',
  {
    id: text('id').primaryKey(),
    leaderAgentId: text('leader_agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id').references(() => users.id, { onDelete: 'restrict' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    tutorSessionId: text('tutor_session_id'),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: text('created_by'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('agent_team_runs_idempotency_unique_idx').on(table.idempotencyKey),
    studentIdx: index('agent_team_runs_student_idx').on(table.studentUserId, table.createdAt),
    statusIdx: index('agent_team_runs_status_idx').on(table.status, table.createdAt),
    leaseIdx: index('agent_team_runs_lease_idx').on(table.leaseExpiresAt),
  }),
);

export const agentTeamTasks = pgTable(
  'agent_team_tasks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => agentTeamRuns.id, { onDelete: 'cascade' }),
    parentTaskId: text('parent_task_id'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'restrict' }),
    taskType: text('task_type').notNull(),
    status: text('status').notNull().default('queued'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    errorCode: text('error_code'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    idempotencyKey: text('idempotency_key').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('agent_team_tasks_idempotency_unique_idx').on(table.idempotencyKey),
    runIdx: index('agent_team_tasks_run_idx').on(table.runId, table.createdAt),
    agentStatusIdx: index('agent_team_tasks_agent_status_idx').on(table.agentId, table.status),
    leaseIdx: index('agent_team_tasks_lease_idx').on(table.leaseExpiresAt),
  }),
);

export const agentTeamMessages = pgTable(
  'agent_team_messages',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => agentTeamRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => agentTeamTasks.id, { onDelete: 'cascade' }),
    mailboxAgentId: text('mailbox_agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'restrict' }),
    senderAgentId: text('sender_agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'restrict' }),
    recipientAgentId: text('recipient_agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'restrict' }),
    messageType: text('message_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('queued'),
    correlationId: text('correlation_id'),
    causationId: text('causation_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('agent_team_messages_idempotency_unique_idx').on(table.idempotencyKey),
    mailboxIdx: index('agent_team_messages_mailbox_idx').on(table.mailboxAgentId, table.status, table.availableAt),
    runIdx: index('agent_team_messages_run_idx').on(table.runId, table.createdAt),
    correlationIdx: index('agent_team_messages_correlation_idx').on(table.correlationId),
    leaseIdx: index('agent_team_messages_lease_idx').on(table.leaseExpiresAt),
  }),
);

export const agentTeamEvents = pgTable(
  'agent_team_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').references(() => agentTeamRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => agentTeamTasks.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    sequence: integer('sequence').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    idempotencyKey: text('idempotency_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('agent_team_events_idempotency_unique_idx').on(table.idempotencyKey),
    runSequenceIdx: index('agent_team_events_run_sequence_idx').on(table.runId, table.sequence),
    topicIdx: index('agent_team_events_topic_idx').on(table.topic, table.createdAt),
  }),
);

/** A lightweight durable mailbox/lease projection for each registered agent. */
export const agentMailboxes = pgTable('agent_mailboxes', {
  agentId: text('agent_id')
    .primaryKey()
    .references(() => agentConfigs.id, { onDelete: 'cascade' }),
  pendingCount: integer('pending_count').notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  cursor: text('cursor'),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Explicit route allow-list used by delegate; parentAgentId is only hierarchy. */
export const agentRoutes = pgTable(
  'agent_routes',
  {
    id: text('id').primaryKey(),
    fromAgentId: text('from_agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'cascade' }),
    toAgentId: text('to_agent_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull().default('delegate'),
    taskType: text('task_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown> | null>(),
    outputSchema: jsonb('output_schema').$type<Record<string, unknown> | null>(),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    routeUniqueIdx: uniqueIndex('agent_routes_route_unique_idx').on(table.fromAgentId, table.toAgentId, table.trigger, table.taskType),
    fromIdx: index('agent_routes_from_idx').on(table.fromAgentId, table.enabled),
    toIdx: index('agent_routes_to_idx').on(table.toAgentId, table.enabled),
  }),
);

/** Candidate projections produced by profile/growth agents. Domain services own acceptance. */
export const agentProjectionCandidates = pgTable(
  'agent_projection_candidates',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').references(() => agentTeamRuns.id, { onDelete: 'set null' }),
    taskId: text('task_id').references(() => agentTeamTasks.id, { onDelete: 'set null' }),
    agentId: text('agent_id').notNull().references(() => agentConfigs.id, { onDelete: 'restrict' }),
    projectionType: text('projection_type').notNull(),
    studentUserId: text('student_user_id').references(() => users.id, { onDelete: 'restrict' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('proposed'),
    idempotencyKey: text('idempotency_key').notNull(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('agent_projection_candidates_idempotency_unique_idx').on(table.idempotencyKey),
    studentIdx: index('agent_projection_candidates_student_idx').on(table.studentUserId, table.createdAt),
    statusIdx: index('agent_projection_candidates_status_idx').on(table.status, table.createdAt),
  }),
);
