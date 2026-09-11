import { integer, text, timestamp, index, foreignKey, unique, uuid } from 'drizzle-orm/pg-core';
import { app } from './app.schema';
import { documents } from './documents.schema';
import { siteStructures } from './site-structures.schema';

export const structureNodes = app.table('structure_nodes', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  structureId: uuid('structure_id').notNull(),
  parentNodeId: uuid('parent_node_id'),
  position: integer().default(0).notNull(),
  name: text().notNull(),
  slug: text().notNull(),
  nodeType: text('node_type').default('section').notNull(),
  documentId: uuid('document_id'),
  externalUrl: text('external_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
}, (table) => [
  index('idx_structure_nodes_document').using('btree', table.documentId.asc().nullsLast()),
  index('idx_structure_nodes_parent').using('btree', table.parentNodeId.asc().nullsLast(), table.position.asc().nullsLast()),
  index('idx_structure_nodes_structure').using('btree', table.structureId.asc().nullsLast()),
  foreignKey({
    columns: [table.structureId],
    foreignColumns: [siteStructures.id],
    name: 'structure_nodes_structure_id_fkey',
  }),
  foreignKey({
    columns: [table.parentNodeId],
    foreignColumns: [table.id],
    name: 'structure_nodes_parent_node_id_fkey',
  }),
  foreignKey({
    columns: [table.documentId],
    foreignColumns: [documents.id],
    name: 'structure_nodes_document_id_fkey',
  }),
  unique('structure_nodes_structure_id_parent_node_id_slug_key').on(table.structureId, table.parentNodeId, table.slug),
]);
