import { integer, text, timestamp, index, foreignKey, unique, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { branches } from './branches.sql';
import { documents } from './documents.sql';

export const documentVersions = app.table('document_versions', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  documentId: uuid('document_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  snapshot: jsonb(),
  source: text().default('edit').notNull(),
  createdById: uuid('created_by_id').notNull(),
  createdByType: text('created_by_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  isTombstone: boolean('is_tombstone').default(false).notNull(),
  sourceBranchId: uuid('source_branch_id'),
  sourceVersionId: uuid('source_version_id'),
  publishedToVersionId: uuid('published_to_version_id'),
  patch: jsonb(),
  actionType: text('action_type'),
  actionMetadata: jsonb('action_metadata'),
  pinnedAt: timestamp('pinned_at', { withTimezone: true, mode: 'date' }),
  supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_versions_live_on_branch').using('btree', table.branchId.asc().nullsLast(), table.documentId.asc().nullsLast(), table.versionNumber.desc().nullsFirst()).where(sql`(superseded_at IS NULL)`),
  index('idx_document_versions_source_branch').using('btree', table.sourceBranchId.asc().nullsLast()).where(sql`(source_branch_id IS NOT NULL)`),
  index('idx_document_versions_tombstone').using('btree', table.documentId.asc().nullsLast(), table.branchId.asc().nullsLast()).where(sql`(is_tombstone = true)`),
  index('idx_versions_branch').using('btree', table.branchId.asc().nullsLast()),
  index('idx_versions_doc_branch').using('btree', table.documentId.asc().nullsLast(), table.branchId.asc().nullsLast()),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'document_versions_document_id_fkey',
  }),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'document_versions_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.sourceBranchId],
    foreignColumns: [branches.id],
    name: 'document_versions_source_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.sourceVersionId],
    foreignColumns: [table.id],
    name: 'document_versions_source_version_id_fkey',
  }).onDelete('set null'),
  foreignKey({
    columns: [table.publishedToVersionId],
    foreignColumns: [table.id],
    name: 'document_versions_published_to_version_id_fkey',
  }),
  unique('document_versions_document_id_branch_id_version_number_key').on(table.documentId, table.branchId, table.versionNumber),
]);
