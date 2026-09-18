import type { Principal } from '../index.js';
import type { AgentActivityMetadata, AgentProposalMetadata } from './agent.js';

export type CommentAuthorType = Principal['type'];

/**
 * Who wrote a comment. Fields match the site members roster so one component
 * renders both.
 */
export interface CommentAuthor {
  type: CommentAuthorType;
  id: string;
  name: string | null;
  avatar: string | null;
  /** Present when an agent posted on a user's behalf. */
  requestedBy?: { id: string; name: string | null };
}

export interface CommentMention {
  type: CommentAuthorType;
  id: string;
  /** Null when the mentioned member has since left the site. */
  name: string | null;
}

/**
 * What a comment is. A `message` is what a person (or an agent) said; the
 * agent kinds carry the state of a piece of work in `metadata`.
 */
export type CommentKind = 'message' | 'agent_activity' | 'agent_proposal';

export type CommentMetadata = AgentActivityMetadata | AgentProposalMetadata;

export interface Comment {
  id: string;
  threadId: string;
  kind: CommentKind;
  /** Plain text with inline `${mention|user:uuid}` tokens. */
  body: string;
  /** Null on a `message`; the work's state on the agent kinds. */
  metadata: CommentMetadata | null;
  author: CommentAuthor;
  mentions: CommentMention[];
  createdAt: string;
  editedAt: string | null;
}

/** A comment as written or rewritten: its kind decides which metadata it carries. */
export type CommentContent =
  | { kind: 'message'; body: string; metadata?: null }
  | { kind: 'agent_activity'; body: string; metadata: AgentActivityMetadata }
  | { kind: 'agent_proposal'; body: string; metadata: AgentProposalMetadata };
