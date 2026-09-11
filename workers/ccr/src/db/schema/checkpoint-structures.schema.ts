import { text, foreignKey, uuid, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.schema';
import { checkpoints } from './checkpoints.schema';
import { siteStructures } from './site-structures.schema';

export const checkpointStructures = app.table('checkpoint_structures', {
  checkpointId: uuid('checkpoint_id').notNull(),
  structureId: uuid('structure_id').notNull(),
  structureTree: jsonb('structure_tree').notNull(),
  metadataSchema: jsonb('metadata_schema').notNull(),
  schemaEnforcement: text('schema_enforcement').notNull(),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  structureType: text('structure_type').notNull(),
}, (table) => [
  foreignKey({
    columns: [table.checkpointId],
    foreignColumns: [checkpoints.id],
    name: 'checkpoint_structures_checkpoint_id_fkey',
  }),
  foreignKey({
    columns: [table.structureId],
    foreignColumns: [siteStructures.id],
    name: 'checkpoint_structures_structure_id_fkey',
  }),
  primaryKey({ columns: [table.checkpointId, table.structureId], name: 'checkpoint_structures_pkey'}),
]);
