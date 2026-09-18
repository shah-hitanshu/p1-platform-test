import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Icon, Tally } from '@pantheon-systems/pds-toolkit-react';

import type { ThreadContext, ThreadSubject } from '../types.js';
import {
  getOpenThread,
  setOpenThread,
  subscribeToOpenThread,
  threadKey,
} from '../open-thread.js';
import { closeOnPointerDownOutside } from '../close-outside.js';
import { usePostComment } from '../use-post-comment.js';
import { useThreadComments } from '../use-thread-comments.js';
import { CommentThread } from './CommentThread.js';
import styles from './CommentTrigger.module.css';

export interface CommentTriggerProps extends ThreadContext {
  /** What to call the thing being discussed, for the thread's header. */
  subject?: ThreadSubject;
  /**
   * Called instead of opening the built-in thread view, for a host that renders the
   * thread somewhere of its own — a side panel rather than beside the content.
   */
  onOpen?: (context: ThreadContext) => void;
  /**
   * Called when the built-in thread view opens and again when it closes, for a host
   * that has to keep the trigger on screen for as long as the thread is up. Closing
   * includes another thread being opened in its place.
   */
  onOpenChange?: (open: boolean) => void;
}

function label(commentCount: number): string {
  if (commentCount === 0) {
    return 'Comment on this';
  }
  return commentCount === 1 ? '1 comment' : `${commentCount} comments`;
}

/**
 * The entry point to a thread about one piece of content.
 *
 * Neutral until something has been said, then filled blue with the comment count badged
 * on its corner, so a reader can tell which blocks are already being discussed without
 * opening anything.
 *
 * Only one thread is open at a time: opening this one closes whichever was open.
 */
export function CommentTrigger({
  contextType,
  contextId,
  threadId,
  commentCount = 0,
  resolved,
  subject,
  onOpen,
  onOpenChange,
}: CommentTriggerProps): React.ReactElement {
  const key = threadKey(contextType, contextId);
  const rootRef = useRef<HTMLSpanElement>(null);
  const openThread = useSyncExternalStore(subscribeToOpenThread, getOpenThread, getOpenThread);
  const open = openThread === key;
  const hasThread = commentCount > 0;
  const { post, posting, failed: postFailed } = usePostComment({ contextType, contextId, threadId });
  const thread = useThreadComments(open ? threadId : undefined);

  useEffect(() => {
    if (!open || !rootRef.current) return;
    return closeOnPointerDownOutside(rootRef.current, () => setOpenThread(null));
  }, [open]);

  const handleClick = useCallback(() => {
    const context = { contextType, contextId, threadId, commentCount, resolved };
    if (onOpen) {
      onOpen(context);
      return;
    }
    setOpenThread(open ? null : key);
  }, [contextType, contextId, threadId, commentCount, resolved, onOpen, open, key]);

  const reportedOpen = useRef(open);
  useEffect(() => {
    if (reportedOpen.current === open) return;
    reportedOpen.current = open;
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(
    () => () => {
      if (getOpenThread() === key) setOpenThread(null);
    },
    [key],
  );

  return (
    <span ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={`${styles.trigger} ${hasThread ? styles.hasThread : ''}`}
        aria-label={label(commentCount)}
        aria-expanded={onOpen ? undefined : open}
        data-testid="comment-trigger"
        data-context-type={contextType}
        data-context-id={contextId}
        onClick={handleClick}
      >
        <Icon iconName="comment" size="s" aria-hidden="true" />
        {hasThread && (
          <Tally
            label={commentCount}
            type="neutral"
            size="xs"
            className={styles.tally}
            aria-hidden="true"
          />
        )}
      </button>
      {open && (
        <CommentThread
          contextType={contextType}
          contextId={contextId}
          threadId={threadId}
          resolved={resolved}
          subject={subject}
          comments={thread.comments}
          loading={thread.loading}
          failed={thread.failed}
          onRetry={thread.retry}
          onPost={post}
          posting={posting}
          postFailed={postFailed}
          onClose={() => setOpenThread(null)}
        />
      )}
    </span>
  );
}
