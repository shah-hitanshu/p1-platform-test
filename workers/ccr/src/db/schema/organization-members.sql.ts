import { text, timestamp, index, foreignKey, unique, uuid, boolean, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.sql';
import { organizations } from './organizations.sql';
import { users } from './users.sql';

export const organizationMembers = app.table('organization_members', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  role: text().default('member').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
}, (table) => [
  index('idx_org_members_org').using('btree', table.organizationId.asc().nullsLast()),
  index('idx_org_members_org_admin').using('btree', table.organizationId.asc().nullsLast()).where(sql`(role = ANY (ARRAY['admin'::text, 'owner'::text]))`),
  index('idx_org_members_user').using('btree', table.userId.asc().nullsLast()),
  foreignKey({
    columns: [table.organizationId],
    foreignColumns: [organizations.id],
    name: 'organization_members_organization_id_fkey',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.userId],
    foreignColumns: [users.id],
    name: 'organization_members_user_id_fkey',
  }).onDelete('cascade'),
  unique('organization_members_organization_id_user_id_key').on(table.organizationId, table.userId),
  check('organization_members_role_check', sql`role = ANY (ARRAY['member'::text, 'admin'::text, 'owner'::text])`),
]);
