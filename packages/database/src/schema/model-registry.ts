import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * LLM model registry: Provider -> Model -> Usage (ADR 0007 / docs/admin/LLM_MODEL_REGISTRY.md).
 *
 * Layering rule (pi-ai): credentials belong to the provider, capabilities belong to
 * the model, selection belongs to the usage.
 *
 * Persistence status (important):
 * - This file defines the **storage structure only**. The model-registry service is
 *   still in-memory; nothing reads/writes these tables yet.
 * - `encrypted_api_key` / `secret_ref` are secret **storage slots**. Application-level
 *   encryption and secret-manager retrieval are NOT implemented; no secret is written
 *   by the current service. Never add a plaintext `api_key` column.
 */

/**
 * model_providers: a gateway + protocol + credential.
 *
 * - `api` is the explicit protocol (`openai-completions` | `openai-responses` |
 *   `anthropic-messages`); it is not inferred at runtime.
 * - `auth_header` selects header-based auth (`Bearer` / `x-api-key`) vs body-carried key.
 * - `secret_ref` points at an external secret manager entry; `encrypted_api_key` holds an
 *   application-encrypted ciphertext. At most one form should be populated once the
 *   service is implemented. Both are nullable because the service is not wired yet.
 * - `key_fingerprint` is the only credential-derived value safe to return to clients.
 */
export const modelProviders = pgTable('model_providers', {
  id: text('id').primaryKey(), // provider id; unique by primary key
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  api: text('api').notNull(), // 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  authHeader: boolean('auth_header').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  // Secret storage slots only; encryption / secret manager wiring is NOT implemented.
  secretRef: text('secret_ref'),
  encryptedApiKey: text('encrypted_api_key'),
  keyFingerprint: text('key_fingerprint'),
  modelsFetchedAt: timestamp('models_fetched_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * model_models: a discoverable model on a provider.
 *
 * - Natural key is `(provider_id, model_id)`; `model_id` is the upstream identifier and
 *   is immutable, so it is the primary key together with the provider.
 * - `source` is `remote` (auto-fetched) or `manual` (admin-declared). Auto-fetched models
 *   conservatively declare text-only modalities.
 * - `provider_id` FK is ON DELETE RESTRICT so a provider with models cannot be deleted
 *   silently; the admin must remove/rebind models explicitly first.
 */
export const modelModels = pgTable(
  'model_models',
  {
    providerId: text('provider_id')
      .notNull()
      .references(() => modelProviders.id, { onDelete: 'restrict' }),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    inputModalities: jsonb('input_modalities').notNull().default(sql`'["text"]'::jsonb`),
    outputModalities: jsonb('output_modalities').notNull().default(sql`'["text"]'::jsonb`),
    contextWindow: integer('context_window'),
    maxTokens: integer('max_tokens'),
    source: text('source').notNull(), // 'remote' | 'manual'
    enabled: boolean('enabled').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.providerId, table.modelId], name: 'model_models_pkey' }),
  }),
);

/**
 * model_usage_bindings: which model serves which usage.
 *
 * - One row per usage (`usage_id` is the PK), e.g. `tutor.chat`, `curriculum.plan`.
 * - `(provider_id, model_id)` is enforced against `model_models` via a composite FK so a
 *   binding can never point at a model that does not exist on that provider.
 * - `provider_id` additionally references `model_providers` directly, both FKs are
 *   ON DELETE RESTRICT: deleting a provider (or model) cannot silently drop a binding.
 */
export const modelUsageBindings = pgTable(
  'model_usage_bindings',
  {
    usageId: text('usage_id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => modelProviders.id, { onDelete: 'restrict' }),
    modelId: text('model_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerModelFk: foreignKey({
      columns: [table.providerId, table.modelId],
      foreignColumns: [modelModels.providerId, modelModels.modelId],
      name: 'model_usage_bindings_provider_model_fk',
    }).onDelete('restrict'),
    providerModelIdx: index('model_usage_bindings_provider_model_idx').on(
      table.providerId,
      table.modelId,
    ),
  }),
);
