import { text, timestamp, foreignKey, unique, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.sql';
import { branches } from './branches.sql';
import { documents } from './documents.sql';

export const branchDocumentPaths = app.table('branch_document_paths', {
  branchId: uuid('branch_id').notNull(),
  documentId: uuid('document_id').notNull(),
  path: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'branch_document_paths_branch_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'branch_document_paths_document_id_fkey',
  }).onDelete('cascade'),
  primaryKey({ columns: [table.branchId, table.documentId], name: 'branch_document_paths_pkey'}),
  unique('branch_document_paths_branch_id_path_key').on(table.branchId, table.path),
]);
