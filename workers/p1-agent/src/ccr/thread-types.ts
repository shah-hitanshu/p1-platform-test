/** The slice of CCR's threads wire contract this worker reads and writes. */

export interface CommentAuthor {
  type: 'user' | 'agent';
  id: string;
  name: string | null;
}

export interface CommentMention {
  type: 'user' | 'agent';
  id: string;
  name: string | null;
}

export interface Comment {
  id: string;
  threadId: string;
  /** Plain text with inline `${mention|user:uuid}` / `${mention|agent:uuid}` tokens. */
  body: string;
  author: CommentAuthor;
  mentions: CommentMention[];
  createdAt: string;
}

export interface ThreadOverview {
  id: string;
  siteId: string;
  context: { type: string; id: string };
  documentId: string | null;
  status: 'open' | 'resolved';
}

export interface ThreadResponse {
  thread: ThreadOverview;
  comments: Comment[];
}

export interface PostCommentResponse {
  thread: ThreadOverview;
  comment: Comment;
}
