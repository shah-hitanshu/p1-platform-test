import type { CommentAuthor, CommentAuthorType } from './actor';

export interface CommentMention {
  type: CommentAuthorType;
  id: string;
  /** Null when the mentioned member has since left the site. */
  name: string | null;
}

/**
 * `message` is what people write. The other two are what an agent leaves in the
 * thread while it works and when it has something to offer: one row that starts
 * as `agent_activity` and becomes the answer, so the thread never shows a stale
 * "working" line above a reply.
 */
export const COMMENT_KINDS = ['message', 'agent_activity', 'agent_proposal'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const ACTIVITY_STATUSES = ['working', 'done', 'failed'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

/** `applying` is held while an accept puts the edits into the page, so a second accept cannot apply them again. */
export const PROPOSAL_STATUSES = ['proposed', 'applying', 'accepted', 'dismissed'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ProposalDecision = Extract<ProposalStatus, 'accepted' | 'dismissed'>;

export const OPERATION_TYPES = ['add', 'remove', 'replace', 'move'] as const;

/** One change to a document, in the same vocabulary the agent's edit tools use. */
export interface ProposedOperation {
  op: (typeof OPERATION_TYPES)[number];
  /** Dot path into the document data, `content.2.props.title` or `content.2`. */
  path: string;
  value?: unknown;
  /** Source path of a `move`. */
  from?: string;
}

export interface AgentActivityMetadata {
  status: ActivityStatus;
}

export interface AgentProposalMetadata {
  status: ProposalStatus;
  /** One line saying what the change does, for the thread. */
  summary: string;
  operations: ProposedOperation[];
  /** Who accepted or dismissed it, once someone has. */
  decidedBy?: CommentAuthor;
  decidedAt?: string;
  /** When an accept began applying it; gone once it is decided or released. */
  claimedAt?: string;
}

export type CommentMetadata = AgentActivityMetadata | AgentProposalMetadata;

export interface Comment {
  id: string;
  threadId: string;
  kind: CommentKind;
  /** Plain text with inline `${mention|user:uuid}` tokens; see the mentions service. */
  body: string;
  /** Null for a `message`; the activity or proposal state for the other kinds. */
  metadata: CommentMetadata | null;
  author: CommentAuthor;
  mentions: CommentMention[];
  createdAt: string;
  /** Set when the author has changed a comment after posting it. */
  editedAt: string | null;
}

/** A comment as persisted, before its mention tokens are hydrated against the roster. */
export type StoredComment = Omit<Comment, 'mentions'>;

/** The body and state an agent writes, when posting or when replacing its own earlier row. */
export type CommentContent =
  | { kind: 'message'; body: string; metadata?: null }
  | { kind: 'agent_activity'; body: string; metadata: AgentActivityMetadata }
  | { kind: 'agent_proposal'; body: string; metadata: AgentProposalMetadata };

export function isAgentProposal(comment: Pick<Comment, 'kind' | 'metadata'>): comment is Pick<Comment, 'kind' | 'metadata'> & { kind: 'agent_proposal'; metadata: AgentProposalMetadata } {
  return comment.kind === 'agent_proposal' && comment.metadata !== null && 'operations' in comment.metadata;
}
