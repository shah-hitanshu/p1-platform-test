import React from 'react';
import type { Comment as CommentRecord } from '@pantheon-systems/css-client';

import type { ProposalActions } from '../proposals.js';
import { useNow } from '../relative-time.js';
import { Comment } from './Comment.js';
import styles from './CommentList.module.css';

export interface CommentListProps {
  /** What has been said so far, oldest first. */
  comments: readonly CommentRecord[];
  /** What the reader can do to an agent's proposal. Nothing, when absent. */
  proposalActions?: ProposalActions;
}

/** Everything said in a thread, in order, on one shared clock for the relative times. */
export function CommentList({ comments, proposalActions }: CommentListProps): React.ReactElement {
  const now = useNow();
  return (
    <ol className={styles.list} aria-label="Comments" data-testid="thread-comments">
      {comments.map((comment) => (
        <Comment key={comment.id} comment={comment} now={now} proposalActions={proposalActions} />
      ))}
    </ol>
  );
}
