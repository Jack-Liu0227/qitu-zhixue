import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Presentation settings only. Teaching versions and authorization remain with their owners. */
export const visualBindings = pgTable('visual_bindings', {
  key: text('key').primaryKey(),
  ownerKind: text('owner_kind').notNull(),
  ownerId: text('owner_id').notNull(),
  usage: text('usage').notNull(),
  assetId: text('asset_id'),
  revision: integer('revision').notNull().default(1),
  operationKey: text('operation_key').notNull(),
  operationHash: text('operation_hash').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
