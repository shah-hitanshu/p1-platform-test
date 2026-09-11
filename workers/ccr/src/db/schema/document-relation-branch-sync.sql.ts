import { integer, text, timestamp, foreignKey, uuid, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { branches } from './branches.sql';
import { documents } from './documents.sql';

export const documentRelationBranchSync = app.table('document_relation_branch_sync', {
  sourceDocumentId: uuid('source_document_id').notNull(),
  relationType: text('relation_type').notNull(),
  branchId: uuid('branch_id').notNull(),
  syncedVersion: integer('synced_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.sourceDocumentId],
    foreignColumns: [documents.id],
    name: 'document_relation_branch_sync_source_document_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'document_relation_branch_sync_branch_id_fkey',
  }).onDelete('cascade'),
  primaryKey({ columns: [table.sourceDocumentId, table.relationType, table.branchId], name: 'document_relation_branch_sync_pkey'}),
  check('document_relation_branch_sync_relation_type_check', sql`relation_type = ANY (ARRAY['template'::text, 'localization'::text])`),
]);
