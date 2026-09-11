import { text, timestamp, index, foreignKey, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { sites } from './sites.sql';

export const agentSiteRoles = app.table('agent_site_roles', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  agentId: uuid('agent_id').notNull(),
  siteId: uuid('site_id').notNull(),
  role: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  createdById: text('created_by_id'),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  uniqueIndex('idx_agent_site_roles_active').using('btree', table.agentId.asc().nullsLast(), table.siteId.asc().nullsLast()).where(sql`(revoked_at IS NULL)`),
  index('idx_agent_site_roles_agent').using('btree', table.agentId.asc().nullsLast()),
  index('idx_agent_site_roles_agent_id').using('btree', table.agentId.asc().nullsLast()).where(sql`(revoked_at IS NULL)`),
  index('idx_agent_site_roles_site').using('btree', table.siteId.asc().nullsLast()),
  index('idx_agent_site_roles_site_id').using('btree', table.siteId.asc().nullsLast()).where(sql`(revoked_at IS NULL)`),
  foreignKey({
    columns: [table.siteId],
    foreignColumns: [sites.id],
    name: 'agent_site_roles_site_id_fkey',
  }).onDelete('cascade'),
]);
