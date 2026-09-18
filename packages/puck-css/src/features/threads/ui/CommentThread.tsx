import React, { useCallback, useId, useState, useRef } from 'react';
import { Badge, Button, Icon, Spinner, Textarea } from '@pantheon-systems/pds-toolkit-react';
import type { Comment } from '@pantheon-systems/css-client';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import type { ThreadContext, ThreadSubject } from '../types.js';
import { useKeepInView } from '../use-keep-in-view.js';
import { CommentList } from './CommentList.js';
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
  onClose: () => void;
}

const KIND_LABEL: Record<ThreadContext['contextType'], string> = {
  block: 'Block',
  page: 'Page',
  site: 'Site',
  workstream: 'Workstream',
};

function isPostShortcut(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && !e.shiftKey;
}

/* Puck maps Backspace and Delete to "remove the selected block" on the canvas
 * document, and its text-field guard misses elements created inside the iframe.
 * Stopping the event at the composer keeps it from ever reaching that listener. */
function isEditingKey(e: React.KeyboardEvent): boolean {
  return e.key === 'Backspace' || e.key === 'Delete';
}

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
  onClose,
}: CommentThreadProps): React.ReactElement {
  const draftId = useId();
  const [draft, setDraft] = useState('');
  const body = draft.trim();
  const canPost = body.length > 0 && !posting;

  const post = useCallback(() => {
    if (!canPost) return;
    // Only what was sent is cleared; anything typed while the post was in flight stays.
    const clearSent = () => setDraft((current) => (current === draft ? '' : current));
    const result = onPost?.(body);
    if (result instanceof Promise) {
      void result.then((landed) => {
        if (landed !== false) clearSent();
      });
    } else {
      clearSent();
    }
  }, [canPost, draft, body, onPost]);

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

      <header className={styles.header}>
        <Badge
          color="silver-muted"
          size="xs"
          className={styles.subject}
          data-testid="comment-thread-subject"
          label={
            <>
              {subject?.icon && <SafeIcon iconName={subject.icon} size="s" aria-hidden="true" />}
              <span className={styles.subjectLabel}>{label}</span>
            </>
          }
        />
        <span className={styles.spacer} />
        {resolved && (
          <Badge
            color="success-muted"
            size="s"
            className={styles.resolved}
            data-testid="comment-thread-resolved"
            label={
              <>
                <Icon iconName="check" size="s" aria-hidden="true" />
                Resolved
              </>
            }
          />
        )}
        <button type="button" className={styles.close} aria-label="Close comments" onClick={onClose}>
          <Icon iconName="xmark" size="m" aria-hidden="true" />
        </button>
      </header>

      <CommentList comments={comments} />
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

      <div className={styles.composer}>
        <Textarea
          id={draftId}
          label="New comment"
          showLabel={false}
          placeholder="Reply or @mention"
          rows={2}
          size="s"
          className={styles.draft}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          textareaProps={{
            onKeyDown: (e) => {
              if (isPostShortcut(e)) {
                e.preventDefault();
                post();
              }
              if (isEditingKey(e)) e.stopPropagation();
            },
          }}
        />
        {postFailed && (
          <span className={styles.postFailed} role="alert" data-testid="comment-thread-post-failed">
            Your comment could not be posted. Try again.
          </span>
        )}
        <div className={styles.composerFooter}>
          <span className={styles.help}>@ to mention · ⏎ to send</span>
          <Button
            label="Post"
            size="s"
            variant="primary"
            className={styles.post}
            disabled={!canPost}
            onClick={post}
            data-testid="comment-thread-post"
          />
        </div>
      </div>
    </div>
  );
}
