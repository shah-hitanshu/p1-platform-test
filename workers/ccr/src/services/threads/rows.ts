import type { CommentAuthorType, CommentKind, ThreadContextType, ThreadStatus } from '../../types/threads';

// Type aliases rather than interfaces: db().execute<T>() constrains T to
// Record<string, unknown>, which an interface does not satisfy.

export type ThreadRow = {
  id: string;
  site_id: string;
  context_type: ThreadContextType;
  context_id: string;
  document_id: string | null;
  branch_id: string | null;
  status: ThreadStatus;
  comment_count: number | string;
  last_comment_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by_type: CommentAuthorType | null;
  resolved_by_id: string | null;
  resolved_by_name: string | null;
  resolved_by_avatar: string | null;
};

export type CommentRow = {
  id: string;
  thread_id: string;
  kind: CommentKind;
  body: string;
  metadata: unknown;
  author_type: CommentAuthorType;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  acting_user_id: string | null;
  acting_user_name: string | null;
  created_at: Date | string;
  edited_at: Date | string | null;
};

export type AuthorRow = {
  name: string | null;
  avatar: string | null;
};
