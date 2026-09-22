import React, { useCallback, useMemo, useRef } from 'react';
import { Button, Spinner } from '@pantheon-systems/pds-toolkit-react';
import type { AgentProposalComment, Comment } from '@pantheon-systems/css-client';

import type { ThreadContext, ThreadSubject } from '../types.js';
import { useKeepInView } from '../use-keep-in-view.js';
import type { MentionCandidate } from '../mentions.js';
import type { ProposalActions } from '../proposals.js';
import { CommentComposer } from './CommentComposer.js';
import { CommentList } from './CommentList.js';
import { CommentThreadHeader } from './CommentThreadHeader.js';
import styles from './CommentThread.module.css';

export interface CommentThreadProps
  extends Pick<ThreadContext, 'contextType' | 'contextId' | 'threadId' | 'resolved'> {
  /** What to call the thing being discussed. Falls back to naming its kind. */
  subject?: ThreadSubject;
  /** What has been said so far, oldest first. */
  comments?: readonly Comment[];
  /** The comments are on their way. */
  loading?: boolean;
  /** The comments could not be loaded. */
  failed?: boolean;
  /** Ask for the comments again, offered when they could not be loaded. */
  onRetry?: () => void;
  /**
   * Called with the trimmed draft when the reader posts it. Absent when nothing can be
   * posted. May resolve to `false` to say the body did not land, which keeps the
   * draft in place for another try.
   */
  onPost?: (body: string) => void | Promise<boolean | void>;
  /** A post is in flight. */
  posting?: boolean;
  /** The last post did not land. */
  postFailed?: boolean;
  /** Who can be mentioned with `@`, agents first. Nobody, when absent. */
  mentionCandidates?: readonly MentionCandidate[];
  /**
   * Accepting and dismissing an agent's proposal. Refining one is handled here: the
   * comment goes to the thread, mentioning the agent that made the proposal.
   */
  proposalActions?: Pick<ProposalActions, 'accept' | 'dismiss' | 'deciding' | 'failed'>;
  /** Marks the discussion over. Absent where the reader cannot resolve it. */
  onResolve?: () => void;
  /** The thread is being resolved. */
  resolving?: boolean;
  /** The last attempt to resolve did not land. */
  resolveFailed?: boolean;
  onClose: () => void;
}

const KIND_LABEL: Record<ThreadContext['contextType'], string> = {
  block: 'Block',
  page: 'Page',
  site: 'Site',
  workstream: 'Workstream',
};

/**
 * The thread about one piece of content.
 *
 * Opens beside the trigger it belongs to, with a caret pointing back at it, so a reader
 * can tell which piece of content is being discussed when several threads are in reach.
 * The header names that content outright, for when the caret alone is not enough.
 *
 * Shows what has been said so far and hands a new draft to whoever mounted the view;
 * loading the one and sending the other are the host's to do.
 */
export function CommentThread({
  contextType,
  contextId,
  threadId,
  resolved = false,
  subject,
  comments = [],
  loading = false,
  failed = false,
  onRetry,
  onPost,
  posting = false,
  postFailed = false,
  mentionCandidates,
  proposalActions,
  onResolve,
  resolving = false,
  resolveFailed = false,
  onClose,
}: CommentThreadProps): React.ReactElement {
  const refine = useCallback(
    async (proposal: AgentProposalComment, note: string) => {
      if (!onPost) return false;
      const landed = await onPost(`\${mention|agent:${proposal.author.id}} ${note}`);
      return landed !== false;
    },
    [onPost],
  );
  const actions = useMemo<ProposalActions | undefined>(
    () => (proposalActions || onPost ? { ...proposalActions, refine: onPost ? refine : undefined } : undefined),
    [proposalActions, onPost, refine],
  );

  const label = subject?.label ?? KIND_LABEL[contextType];
  const panelRef = useRef<HTMLDivElement>(null);
  useKeepInView(panelRef);

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-label={`Comments on ${label}`}
      data-testid="comment-thread"
      data-context-type={contextType}
      data-context-id={contextId}
      data-thread-id={threadId}
    >
      <span className={styles.caret} aria-hidden="true" />

      <CommentThreadHeader
        label={label}
        icon={subject?.icon}
        resolved={resolved}
        onResolve={onResolve}
        resolving={resolving}
        resolveFailed={resolveFailed}
        onClose={onClose}
      />

      <CommentList threadId={threadId} comments={comments} proposalActions={actions} />
      {comments.length === 0 && !loading && !failed && (
        <p className={styles.empty} data-testid="comment-thread-empty">
          No comments on this {KIND_LABEL[contextType].toLowerCase()} yet.
        </p>
      )}
      {loading && (
        <div className={styles.status} role="status" data-testid="comment-thread-loading">
          <Spinner isInline size="s" label="Loading comments" />
        </div>
      )}
      {failed && (
        <div className={styles.status} role="alert" data-testid="comment-thread-failed">
          <span>Comments could not be loaded.</span>
          {onRetry && <Button label="Retry" size="s" variant="secondary" onClick={onRetry} />}
        </div>
      )}

      <CommentComposer onPost={onPost} posting={posting} postFailed={postFailed} mentionCandidates={mentionCandidates} />
    </div>
  );
}
