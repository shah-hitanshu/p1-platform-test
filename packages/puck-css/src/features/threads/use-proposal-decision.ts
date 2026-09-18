import { useCallback, useContext, useState } from 'react';
import type { AgentProposalComment, ProposalDecision } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import type { ProposalActions } from './proposals.js';
import { applyThreadOverview } from './thread-cache.js';
import { appendThreadComment } from './thread-comments.js';

export interface UseProposalDecisionOptions {
  threadId?: string;
}

/**
 * Accepting or dismissing an agent's proposal.
 *
 * Both are one request. Accepting has the service put the edits into the page as the
 * person accepting, so the change reaches this editor and every other open one the same
 * way any edit does; a proposal the page refuses stays undecided and the refusal is
 * reported. The rewritten comment goes back into the open thread the way a posted one
 * does.
 */
export function useProposalDecision({ threadId }: UseProposalDecisionOptions): ProposalActions {
  const ccr = useP1PuckOptional();
  const queryClient = useContext(P1SdkQueryClientContext);
  const client = ccr?.client;
  const siteId = ccr?.siteId;
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const decide = useCallback(
    async (comment: AgentProposalComment, decision: ProposalDecision) => {
      if (!client || !siteId || !threadId) return false;
      setDeciding(comment.id);
      setFailed(null);
      try {
        const result = await client.threads.decideProposal(siteId, threadId, comment.id, decision);
        if (queryClient) {
          applyThreadOverview(queryClient, result.thread);
          appendThreadComment(queryClient, siteId, result.comment);
        }
        return true;
      } catch {
        setFailed(comment.id);
        return false;
      } finally {
        setDeciding(null);
      }
    },
    [client, siteId, threadId, queryClient],
  );

  const accept = useCallback((comment: AgentProposalComment) => decide(comment, 'accepted'), [decide]);
  const dismiss = useCallback((comment: AgentProposalComment) => decide(comment, 'dismissed'), [decide]);

  const ready = Boolean(client && siteId && threadId);
  return {
    accept: ready ? accept : undefined,
    dismiss: ready ? dismiss : undefined,
    deciding,
    failed,
  };
}
