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

export type CommentKind = 'message' | 'agent_activity' | 'agent_proposal';

export interface ProposedOperation {
  op: 'add' | 'remove' | 'replace' | 'move';
  /** Dot path into the document data, e.g. `content.2.props.title`. */
  path: string;
  value?: unknown;
  from?: string;
}

export interface AgentActivityMetadata {
  status: 'working' | 'done' | 'failed';
}

export interface AgentProposalMetadata {
  status: 'proposed' | 'applying' | 'accepted' | 'dismissed';
  summary: string;
  operations: ProposedOperation[];
}

/** What this worker writes: a working line, a plain comment, or a proposal. */
export type CommentContent =
  | { kind: 'message'; body: string }
  | { kind: 'agent_activity'; body: string; metadata: AgentActivityMetadata }
  | { kind: 'agent_proposal'; body: string; metadata: AgentProposalMetadata };

export interface Comment {
  id: string;
  threadId: string;
  kind: CommentKind;
  /** Plain text with inline `${mention|user:uuid}` / `${mention|agent:uuid}` tokens. */
  body: string;
  metadata: AgentActivityMetadata | AgentProposalMetadata | null;
  author: CommentAuthor;
  mentions: CommentMention[];
  createdAt: string;
}

export interface ThreadOverview {
  id: string;
  siteId: string;
  context: { type: string; id: string };
  documentId: string | null;
  branchId: string | null;
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
