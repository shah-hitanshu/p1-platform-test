import { text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.sql';

export const importIdMaps = app.table('import_id_maps', {
  importKey: text('import_key').notNull(),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  entityType: text('entity_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('idx_import_id_maps_key').using('btree', table.importKey.asc().nullsLast()),
  primaryKey({ columns: [table.importKey, table.sourceId, table.entityType], name: 'import_id_maps_pkey'}),
]);
