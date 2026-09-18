import React from 'react';
import { Avatar, Badge } from '@pantheon-systems/pds-toolkit-react';
import type { Comment as CommentRecord } from '@pantheon-systems/css-client';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import { commentBodyParts } from '../comment-body.js';
import { relativeTime } from '../relative-time.js';
import styles from './Comment.module.css';

export interface CommentProps {
  comment: CommentRecord;
  /** The moment to measure the comment's age from, shared by every comment in a list. */
  now: number;
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
        <SafeIcon iconName="sparkles" size="s" />
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

/** One message in a thread: who said it, when, and what, with mentions drawn as chips. */
export function Comment({ comment, now }: CommentProps): React.ReactElement {
  return (
    <li className={styles.comment} data-testid="thread-comment" data-comment-id={comment.id}>
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
        <p className={styles.text}>
          {commentBodyParts(comment).map((part, i) =>
            part.kind === 'text' ? (
              <React.Fragment key={i}>{part.text}</React.Fragment>
            ) : (
              <span key={i} className={styles.mention} data-testid="comment-mention">
                {part.type === 'agent' && <SafeIcon iconName="sparkles" size="s" />}@{part.name}
              </span>
            ),
          )}
        </p>
      </div>
    </li>
  );
}
