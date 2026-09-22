import React, { useLayoutEffect, useRef } from 'react';
import type { Comment as CommentRecord } from '@pantheon-systems/css-client';

import type { ProposalActions } from '../proposals.js';
import { useNow } from '../relative-time.js';
import { Comment } from './Comment.js';
import styles from './CommentList.module.css';

/** Sentinel for "we have not jumped to the bottom for any thread yet", distinct from
 * `undefined` so a draft thread (whose `threadId` is itself `undefined`) still takes
 * the jump branch on its first render instead of being mistaken for an already-scrolled
 * thread. */
const NONE = Symbol('none');

export interface CommentListProps {
  /** Which thread these comments belong to, so switching threads re-triggers the
   * jump-to-bottom even when the new thread happens to have the same comment count.
   * Absent for a thread that has not been created yet. */
  threadId: string | undefined;
  /** What has been said so far, oldest first. */
  comments: readonly CommentRecord[];
  /** What the reader can do to an agent's proposal. Nothing, when absent. */
  proposalActions?: ProposalActions;
}

/** Everything said in a thread, in order, on one shared clock for the relative times. */
export function CommentList({ threadId, comments, proposalActions }: CommentListProps): React.ReactElement {
  const now = useNow();
  const listRef = useRef<HTMLOListElement>(null);
  // Tracks which thread we last jumped to the bottom for. Keyed on `threadId`, not just
  // set once on mount, since the caller does not guarantee a remount (no
  // `key={threadId}`) when it swaps `comments` for a different thread's.
  const scrolledForThread = useRef<string | undefined | typeof NONE>(NONE);

  // Opening a thread should land on the most recent message; every comment added after
  // that (posted here or added by an agent's reply) should scroll smoothly into view
  // instead of jumping.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || comments.length === 0) return;

    if (scrolledForThread.current !== threadId) {
      scrolledForThread.current = threadId;
      list.scrollTop = list.scrollHeight;
      return;
    }

    list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [threadId, comments.length]);

  return (
    <ol ref={listRef} className={styles.list} aria-label="Comments" data-testid="thread-comments">
      {comments.map((comment) => (
        <Comment key={comment.id} comment={comment} now={now} proposalActions={proposalActions} />
      ))}
    </ol>
  );
}
