import { foreignKey, uuid, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.schema';
import { checkpoints } from './checkpoints.schema';
import { documents } from './documents.schema';
import { siteStructures } from './site-structures.schema';

export const checkpointDocumentMetadata = app.table('checkpoint_document_metadata', {
  checkpointId: uuid('checkpoint_id').notNull(),
  structureId: uuid('structure_id').notNull(),
  documentId: uuid('document_id').notNull(),
  metadata: jsonb().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.checkpointId],
    foreignColumns: [checkpoints.id],
    name: 'checkpoint_document_metadata_checkpoint_id_fkey',
  }),
  foreignKey({
    columns: [table.structureId],
    foreignColumns: [siteStructures.id],
    name: 'checkpoint_document_metadata_structure_id_fkey',
  }),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'checkpoint_document_metadata_document_id_fkey',
  }),
  primaryKey({ columns: [table.checkpointId, table.structureId, table.documentId], name: 'checkpoint_document_metadata_pkey'}),
]);
