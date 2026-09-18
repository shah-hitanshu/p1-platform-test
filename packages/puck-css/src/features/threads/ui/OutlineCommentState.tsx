import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

import { useThreadsEnabled } from '../enabled.js';
import { useThreadOverview } from '../use-document-threads.js';
import styles from './OutlineCommentState.module.css';

export interface OutlineCommentStateProps {
  /** The Puck component id of the block this outline row stands for. */
  blockId: string;
}

function commentsLabel(count: number): string {
  return count === 1 ? '1 comment' : `${count} comments`;
}

/**
 * A block's comment state, as the outline shows it beside the block's name.
 *
 * Reads the same page listing the block's trigger reads, so the two agree: the open
 * thread's count while there is one, a check once every thread on the block has been
 * resolved, and nothing for a block nobody has commented on.
 */
export function OutlineCommentState({ blockId }: OutlineCommentStateProps): React.ReactElement | null {
  const enabled = useThreadsEnabled();
  const thread = useThreadOverview('block', blockId);
  if (!enabled || !thread) return null;

  if (thread.status === 'resolved') {
    return (
      <span
        className={styles.resolved}
        role="img"
        aria-label="Comments resolved"
        data-testid="outline-comments-resolved"
      >
        <Icon iconName="check" size="s" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={styles.open}
      role="img"
      aria-label={commentsLabel(thread.commentCount)}
      data-testid="outline-comment-count"
    >
      <Icon iconName="comment" size="s" aria-hidden="true" />
      {thread.commentCount}
    </span>
  );
}
