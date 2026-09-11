import { text, timestamp, index, foreignKey, unique, uuid, jsonb, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { app } from './app.sql';
import { branches } from './branches.sql';
import { siteStructures } from './site-structures.sql';

export const branchStructureState = app.table('branch_structure_state', {
  branchId: uuid('branch_id').notNull(),
  structureId: uuid('structure_id').notNull(),
  structureTree: jsonb('structure_tree').default([]).notNull(),
  metadataSchema: jsonb('metadata_schema').default({'type':'object','required':['title'],'properties':{'title':{'type':'string','maxLength':100},'description':{'type':'string','maxLength':300}}}).notNull(),
  schemaEnforcement: text('schema_enforcement').default('warn').notNull(),
  hasChangesSinceCheckpoint: boolean('has_changes_since_checkpoint').default(false),
  lastModifiedAt: timestamp('last_modified_at', { withTimezone: true, mode: 'date' }),
  lastModifiedBy: uuid('last_modified_by'),
  name: text().notNull(),
  slug: text().notNull(),
  description: text(),
  structureType: text('structure_type').default('hierarchy').notNull(),
}, (table) => [
  index('idx_branch_structure_state_slug').using('btree', table.branchId.asc().nullsLast(), table.slug.asc().nullsLast()),
  foreignKey({
    columns: [table.branchId],
    foreignColumns: [branches.id],
    name: 'branch_structure_state_branch_id_fkey',
  }),
  foreignKey({
    columns: [table.structureId],
    foreignColumns: [siteStructures.id],
    name: 'branch_structure_state_structure_id_fkey',
  }),
  primaryKey({ columns: [table.branchId, table.structureId], name: 'branch_structure_state_pkey'}),
  unique('unique_branch_slug').on(table.branchId, table.slug),
]);
