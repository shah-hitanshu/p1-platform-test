import type { CommentAuthor, CommentMetadata, StoredComment, ThreadOverview } from '../../types/threads';
import type { CommentRow, ThreadRow } from './rows';

export function toThreadOverview(row: ThreadRow): ThreadOverview {
  const resolvedBy: CommentAuthor | null =
    row.resolved_by_type !== null && row.resolved_by_id !== null
      ? {
        type: row.resolved_by_type,
        id: row.resolved_by_id,
        name: row.resolved_by_name,
        avatar: row.resolved_by_avatar,
      }
      : null;

  return {
    id: row.id,
    siteId: row.site_id,
    context: { type: row.context_type, id: row.context_id },
    documentId: row.document_id,
    branchId: row.branch_id,
    status: row.status,
    commentCount: Number(row.comment_count),
    lastCommentAt: toIso(row.last_comment_at ?? row.created_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    resolvedAt: row.resolved_at === null ? null : toIso(row.resolved_at),
    resolvedBy,
  };
}

export function toStoredComment(row: CommentRow): StoredComment {
  const author: CommentAuthor = {
    type: row.author_type,
    id: row.author_id,
    name: row.author_name,
    avatar: row.author_avatar,
  };
  if (row.acting_user_id !== null) {
    author.requestedBy = { id: row.acting_user_id, name: row.acting_user_name };
  }

  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    body: row.body,
    metadata: toMetadata(row.metadata),
    author,
    createdAt: toIso(row.created_at),
    editedAt: row.edited_at === null ? null : toIso(row.edited_at),
  };
}

/** jsonb comes back parsed from pg; anything that is not an object is treated as absent. */
function toMetadata(value: unknown): CommentMetadata | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as CommentMetadata) : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
