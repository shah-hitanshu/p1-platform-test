import { text, timestamp, foreignKey, uuid, jsonb, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { branches } from './branches.schema';
import { documents } from './documents.schema';

export const documentRelationBranchResolutions = app.table('document_relation_branch_resolutions', {
  sourceDocumentId: uuid('source_document_id').notNull(),
  relationType: text('relation_type').notNull(),
  branchId: uuid('branch_id').notNull(),
  resolutions: jsonb().default({}).notNull(),
  inherited: jsonb().default({}).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.sourceDocumentId],
    foreignColumns: [documents.id],
    name: 'document_relation_branch_resolutions_source_document_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'document_relation_branch_resolutions_branch_id_fkey',
  }).onDelete('cascade'),
  primaryKey({ columns: [table.sourceDocumentId, table.relationType, table.branchId], name: 'document_relation_branch_resolutions_pkey'}),
  check('document_relation_branch_resolutions_relation_type_check', sql`relation_type = ANY (ARRAY['template'::text, 'localization'::text])`),
]);
