import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Server-owned Agent governance configuration, independent from tutor_partners. */
export const agentConfigs = pgTable('agent_configs', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  role: text('role'),
  roleDefinition: text('role_definition').notNull(),
  agentDefinition: text('agent_definition').notNull().default(''),
  modelProviderId: text('model_provider_id'),
  modelId: text('model_id'),
  // Kept for compatibility with pre-direct-selection rows and old runtime callers.
  modelUsage: text('model_usage').notNull().default('tutor.chat'),
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  parentAgentId: text('parent_agent_id'),
  enabled: boolean('enabled').notNull().default(true),
  configVersion: integer('config_version').notNull().default(1),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  parentIdx: index('agent_configs_parent_idx').on(table.parentAgentId),
  enabledIdx: index('agent_configs_enabled_idx').on(table.enabled),
  modelIdx: index('agent_configs_model_idx').on(table.modelProviderId, table.modelId),
}));

export const agentSkillBindings = pgTable('agent_skill_bindings', {
  agentId: text('agent_id').notNull(),
  skillId: text('skill_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  inheritToChildren: boolean('inherit_to_children').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.agentId, table.skillId], name: 'agent_skill_bindings_pkey' }),
  skillIdx: index('agent_skill_bindings_skill_idx').on(table.skillId),
}));

export const agentToolBindings = pgTable('agent_tool_bindings', {
  agentId: text('agent_id').notNull(),
  toolId: text('tool_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.agentId, table.toolId], name: 'agent_tool_bindings_pkey' }),
  toolIdx: index('agent_tool_bindings_tool_idx').on(table.toolId),
}));

export const runtimeMcpServers = pgTable('runtime_mcp_servers', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  transport: text('transport').notNull(),
  description: text('description'),
  endpointOrigin: text('endpoint_origin'),
  toolIds: jsonb('tool_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  enabled: boolean('enabled').notNull().default(false),
  status: text('status').notNull().default('not_configured'),
  toolCount: integer('tool_count'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),
  secretRef: text('secret_ref'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentMcpBindings = pgTable('agent_mcp_bindings', {
  agentId: text('agent_id').notNull(),
  mcpServerId: text('mcp_server_id').notNull(),
  allowedToolIds: jsonb('allowed_tool_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.agentId, table.mcpServerId], name: 'agent_mcp_bindings_pkey' }),
  serverIdx: index('agent_mcp_bindings_server_idx').on(table.mcpServerId),
}));
