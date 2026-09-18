import type { AgentProposalComment, Comment } from '@pantheon-systems/css-client';

/**
 * What a reader can do to a proposal, handed down to the card that shows it. Each
 * resolves to whether it landed. Absent where the thread has no editor to act through.
 */
export interface ProposalActions {
  accept?: (comment: AgentProposalComment) => Promise<boolean>;
  dismiss?: (comment: AgentProposalComment) => Promise<boolean>;
  /** Asks the agent that made the proposal to try again with this guidance. */
  refine?: (comment: AgentProposalComment, body: string) => Promise<boolean>;
  /** The proposal whose decision is in flight, if any. */
  deciding?: string | null;
  /** The proposal whose last decision did not land, if any. */
  failed?: string | null;
}

/** Who asked the agent to do the work, when it was posted on someone's behalf. */
export function requesterName(comment: Comment): string | null {
  return comment.author.requestedBy?.name ?? null;
}

export function agentName(comment: Comment): string {
  return comment.author.name ?? 'Agent';
}
