import { index, foreignKey, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.sql';
import { checkpoints } from './checkpoints.sql';
import { documentVersions } from './document-versions.sql';
import { documents } from './documents.sql';

export const checkpointDocuments = app.table('checkpoint_documents', {
  checkpointId: uuid('checkpoint_id').notNull(),
  documentId: uuid('document_id').notNull(),
  documentVersionId: uuid('document_version_id').notNull(),
}, (table) => [
  index('idx_checkpoint_documents_document').using('btree', table.documentId.asc().nullsLast(), table.checkpointId.asc().nullsLast()),
  index('idx_checkpoint_documents_version_id').using('btree', table.documentVersionId.asc().nullsLast()),
  foreignKey({
    columns: [table.checkpointId],
    foreignColumns: [checkpoints.id],
    name: 'checkpoint_documents_checkpoint_id_fkey',
  }),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'checkpoint_documents_document_id_fkey',
  }),
  foreignKey({
    columns: [table.documentVersionId],
    foreignColumns: [documentVersions.id],
    name: 'checkpoint_documents_document_version_id_fkey',
  }),
  primaryKey({ columns: [table.checkpointId, table.documentId], name: 'checkpoint_documents_pkey'}),
]);
