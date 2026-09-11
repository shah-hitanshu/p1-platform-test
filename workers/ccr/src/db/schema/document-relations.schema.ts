import { integer, text, timestamp, index, foreignKey, unique, uuid, jsonb, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { documentVersions } from './document-versions.schema';
import { documents } from './documents.schema';

export const documentRelations = app.table('document_relations', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  sourceDocumentId: uuid('source_document_id').notNull(),
  targetDocumentId: uuid('target_document_id').notNull(),
  relationType: text('relation_type').notNull(),
  syncedVersion: integer('synced_version'),
  metadata: jsonb().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  syncedVersionId: uuid('synced_version_id'),
}, (table) => [
  index('idx_document_relations_target').using('btree', table.targetDocumentId.asc().nullsLast(), table.syncedVersion.asc().nullsLast()),
  index('idx_document_relations_synced_version_id').using('btree', table.syncedVersionId.asc().nullsLast()).where(sql`(synced_version_id IS NOT NULL)`),
  foreignKey({
    columns: [table.sourceDocumentId],
    foreignColumns: [documents.id],
    name: 'document_relations_source_document_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.targetDocumentId],
    foreignColumns: [documents.id],
    name: 'document_relations_target_document_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.syncedVersionId],
    foreignColumns: [documentVersions.id],
    name: 'document_relations_synced_version_id_fkey',
  }).onDelete('set null'),
  unique('document_relations_source_document_id_relation_type_key').on(table.sourceDocumentId, table.relationType),
  check('document_relations_relation_type_check', sql`relation_type = ANY (ARRAY['template'::text, 'localization'::text])`),
]);
