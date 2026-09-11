import { timestamp, index, foreignKey, uuid, jsonb, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.schema';
import { branches } from './branches.schema';
import { documents } from './documents.schema';
import { siteStructures } from './site-structures.schema';

export const branchDocumentMetadata = app.table('branch_document_metadata', {
  branchId: uuid('branch_id').notNull(),
  structureId: uuid('structure_id').notNull(),
  documentId: uuid('document_id').notNull(),
  metadata: jsonb().default({}).notNull(),
  conformsToSchema: boolean('conforms_to_schema').default(true),
  validationErrors: jsonb('validation_errors').default([]),
  lastModifiedAt: timestamp('last_modified_at', { withTimezone: true, mode: 'date' }),
  lastModifiedBy: uuid('last_modified_by'),
}, (table) => [
  index('idx_branch_doc_metadata_conformance').using('btree', table.branchId.asc().nullsLast(), table.structureId.asc().nullsLast(), table.conformsToSchema.asc().nullsLast()),
  index('idx_branch_doc_metadata_document').using('btree', table.documentId.asc().nullsLast()),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'branch_document_metadata_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.structureId],
    foreignColumns: [siteStructures.id],
    name: 'branch_document_metadata_structure_id_fkey',
  }),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'branch_document_metadata_document_id_fkey',
  }),
  primaryKey({ columns: [table.branchId, table.structureId, table.documentId], name: 'branch_document_metadata_pkey'}),
]);
