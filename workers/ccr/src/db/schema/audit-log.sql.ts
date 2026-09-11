import { text, timestamp, index, uuid, jsonb } from 'drizzle-orm/pg-core';
import { app } from './app.sql';

export const auditLog = app.table('audit_log', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  action: text().notNull(),
  actorUserId: uuid('actor_user_id'),
  actorEmail: text('actor_email'),
  actorSystemRole: text('actor_system_role'),
  organizationId: uuid('organization_id'),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  targetLabel: text('target_label'),
  details: jsonb().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('idx_audit_log_created').using('btree', table.createdAt.desc().nullsFirst()),
]);
