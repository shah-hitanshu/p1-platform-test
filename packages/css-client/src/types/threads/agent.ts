import type { Comment, CommentAuthor } from './comment.js';

export type ActivityStatus = 'working' | 'done' | 'failed';

/** `applying` is held while an accept puts the edits into the page; the card still offers the buttons, and the service refuses a second accept while the first is at work. */
export type ProposalStatus = 'proposed' | 'applying' | 'accepted' | 'dismissed';

/** What a reader can do to a proposal that is still waiting. */
export type ProposalDecision = Extract<ProposalStatus, 'accepted' | 'dismissed'>;

/**
 * One change to the document, addressed by a dot path into its data
 * (`content.2.props.title`). `from` is the source path of a `move`.
 */
export interface ProposedOperation {
  op: 'add' | 'remove' | 'replace' | 'move';
  path: string;
  value?: unknown;
  from?: string;
}

export interface AgentActivityMetadata {
  status: ActivityStatus;
}

export interface AgentProposalMetadata {
  status: ProposalStatus;
  /** One line saying what the operations do, for the card. */
  summary: string;
  operations: ProposedOperation[];
  /** Who accepted or dismissed it, once someone has. */
  decidedBy?: CommentAuthor;
  decidedAt?: string;
  /** When an accept began applying it; gone once it is decided. */
  claimedAt?: string;
}

export type AgentProposalComment = Comment & { kind: 'agent_proposal'; metadata: AgentProposalMetadata };

export function isAgentProposal(comment: Comment): comment is AgentProposalComment {
  return comment.kind === 'agent_proposal' && comment.metadata !== null && 'operations' in comment.metadata;
}

export function isAgentWorking(comment: Comment): boolean {
  return comment.kind === 'agent_activity' && comment.metadata !== null && 'status' in comment.metadata
    && comment.metadata.status === 'working';
}
