import { text, timestamp, index, foreignKey, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { mergeRequests } from './merge-requests.schema';

export const approvalRequests = app.table('approval_requests', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  mergeRequestId: uuid('merge_request_id').notNull(),
  approverEmail: text('approver_email').notNull(),
  approverName: text('approver_name'),
  tokenHash: text('token_hash'),
  status: text().default('pending').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'date' }),
  comment: text(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
}, (table) => [
  index('idx_approval_requests_mr').using('btree', table.mergeRequestId.asc().nullsLast()),
  index('idx_approval_requests_status').using('btree', table.status.asc().nullsLast()),
  index('idx_approval_requests_token').using('btree', table.tokenHash.asc().nullsLast()).where(sql`(token_hash IS NOT NULL)`),
  foreignKey({
    columns: [table.mergeRequestId],
    foreignColumns: [mergeRequests.id],
    name: 'approval_requests_merge_request_id_fkey',
  }).onDelete('cascade'),
  unique('approval_requests_merge_request_id_approver_email_key').on(table.mergeRequestId, table.approverEmail),
  unique('approval_requests_token_hash_key').on(table.tokenHash),
]);
