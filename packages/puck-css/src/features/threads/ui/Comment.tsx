import React from 'react';
import { Avatar, Badge } from '@pantheon-systems/pds-toolkit-react';
import { isAgentProposal, isAgentWorking, type Comment as CommentRecord } from '@pantheon-systems/css-client';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import { commentBodyParts } from '../comment-body.js';
import { requesterName, type ProposalActions } from '../proposals.js';
import { relativeTime } from '../relative-time.js';
import { ProposalCard } from './ProposalCard.js';
import styles from './Comment.module.css';

export interface CommentProps {
  comment: CommentRecord;
  /** The moment to measure the comment's age from, shared by every comment in a list. */
  now: number;
  /** What the reader can do to a proposal. Nothing, when absent. */
  proposalActions?: ProposalActions;
}

function authorName(comment: CommentRecord): string {
  return comment.author.name ?? (comment.author.type === 'agent' ? 'Agent' : 'Former member');
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function AuthorAvatar({ comment }: { comment: CommentRecord }): React.ReactElement {
  if (comment.author.type === 'agent') {
    return (
      <span className={styles.agentAvatar} aria-hidden="true">
        <SafeIcon iconName="sparkles" size="xs" />
      </span>
    );
  }
  return (
    <Avatar
      className={styles.avatar}
      size="s"
      imageSrc={comment.author.avatar ?? undefined}
      uniqueId={comment.author.id}
      hasUserFallback
      aria-hidden="true"
    />
  );
}

function Body({ comment }: { comment: CommentRecord }): React.ReactElement {
  return (
    <p className={styles.text}>
      {commentBodyParts(comment).map((part, i) =>
        part.kind === 'text' ? (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ) : (
          <span key={i} className={styles.mention} data-testid="comment-mention">
            {part.type === 'agent' && <SafeIcon iconName="sparkles" size="xs" />}@{part.name}
          </span>
        ),
      )}
    </p>
  );
}

function Activity({ comment }: { comment: CommentRecord }): React.ReactElement {
  const working = isAgentWorking(comment);
  const failed = comment.metadata !== null && 'status' in comment.metadata && comment.metadata.status === 'failed';
  const requester = requesterName(comment);
  return (
    <p
      className={`${styles.activity} ${failed ? styles.failed : ''}`}
      role="status"
      data-testid="agent-activity"
      data-status={working ? 'working' : failed ? 'failed' : 'done'}
    >
      {working && <span className={styles.pulse} aria-hidden="true" />}
      {working ? `Working${requester ? ` for ${requester}` : ''}…` : comment.body}
    </p>
  );
}

/**
 * One entry in a thread: who said it, when, and what. A person's comment shows its
 * mentions as chips; an agent's activity shows where its work stands, and its proposal
 * shows as a card the reader can act on.
 */
export function Comment({ comment, now, proposalActions }: CommentProps): React.ReactElement {
  const working = isAgentWorking(comment);
  return (
    <li
      className={`${styles.comment} ${working ? styles.working : ''}`}
      data-testid="thread-comment"
      data-comment-id={comment.id}
      data-kind={comment.kind}
    >
      <AuthorAvatar comment={comment} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.author}>{authorName(comment)}</span>
          {comment.author.type === 'agent' && (
            <Badge className={styles.agentBadge} label="Agent" color="silver-muted" size="xs" />
          )}
          <time className={styles.time} dateTime={comment.createdAt} title={fullDate(comment.createdAt)}>
            {relativeTime(comment.createdAt, now)}
          </time>
        </div>
        {comment.kind === 'agent_activity' ? (
          <Activity comment={comment} />
        ) : isAgentProposal(comment) ? (
          <>
            {comment.body && <Body comment={comment} />}
            <ProposalCard comment={comment} actions={proposalActions} now={now} />
          </>
        ) : (
          <Body comment={comment} />
        )}
      </div>
    </li>
  );
}
