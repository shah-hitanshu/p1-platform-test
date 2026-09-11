import { text, timestamp, index, foreignKey, unique, uuid, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { organizations } from './organizations.sql';

export const sites = app.table('sites', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  pantheonSiteId: text('pantheon_site_id'),
  name: text().notNull(),
  workflowSettings: jsonb('workflow_settings').default({'approverMode':'both','minApprovers':1,'approverMinRole':'EDITOR','allowSelfApproval':true,'mergeApprovalMode':'optional'}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  organizationId: uuid('organization_id'),
  settings: jsonb().default({}).notNull(),
  allowedOrigins: text('allowed_origins').array().default(sql`'{}'::text[]`).notNull(),
  url: text(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_sites_archived').using('btree', table.archivedAt.asc().nullsLast()).where(sql`(archived_at IS NOT NULL)`),
  index('idx_sites_organization').using('btree', table.organizationId.asc().nullsLast()),
  foreignKey({
    columns: [table.organizationId],
    foreignColumns: [organizations.id],
    name: 'sites_organization_id_fkey',
  }),
  unique('sites_pantheon_site_id_key').on(table.pantheonSiteId),
]);
