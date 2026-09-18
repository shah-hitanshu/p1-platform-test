import { text, timestamp, index, foreignKey, uuid, jsonb, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { app } from './app.schema';
import { commentThreads } from './comment-threads.schema';

export const comments = app.table('comments', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  threadId: uuid('thread_id').notNull(),
  kind: text().default('message').notNull(),
  body: text().notNull(),
  metadata: jsonb(),
  authorType: text('author_type').notNull(),
  authorId: uuid('author_id').notNull(),
  actingUserId: uuid('acting_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  index('idx_comments_thread_created').using('btree', table.threadId.asc().nullsLast(), table.createdAt.asc().nullsLast()),
  foreignKey({
    columns: [table.threadId],
    foreignColumns: [commentThreads.id],
    name: 'comments_thread_id_fkey',
  }).onDelete('cascade'),
  check('comments_kind_check', sql`kind = ANY (ARRAY['message'::text, 'agent_activity'::text, 'agent_proposal'::text])`),
  check('comments_author_type_check', sql`author_type = ANY (ARRAY['user'::text, 'agent'::text])`),
]);
