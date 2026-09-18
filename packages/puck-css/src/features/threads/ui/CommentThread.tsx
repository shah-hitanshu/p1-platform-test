import React, { useCallback, useId, useRef, useState } from 'react';
import { Badge, Button, Icon, Textarea } from '@pantheon-systems/pds-toolkit-react';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import type { ThreadContext, ThreadSubject } from '../types.js';
import { useKeepInView } from '../use-keep-in-view.js';
import styles from './CommentThread.module.css';

export interface CommentThreadProps
  extends Pick<ThreadContext, 'contextType' | 'contextId' | 'threadId' | 'resolved'> {
  /** What to call the thing being discussed. Falls back to naming its kind. */
  subject?: ThreadSubject;
  /** Called with the trimmed draft when the reader posts it. Absent until threads are stored. */
  onPost?: (body: string) => void;
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
 * The messages and the composer are slots for now: the list is empty until threads are
 * stored, and posting hands the draft to whoever mounted the view.
 */
export function CommentThread({
  contextType,
  contextId,
  threadId,
  resolved = false,
  subject,
  onPost,
  onClose,
}: CommentThreadProps): React.ReactElement {
  const draftId = useId();
  const [draft, setDraft] = useState('');
  const body = draft.trim();
  const canPost = body.length > 0;

  const post = useCallback(() => {
    if (!canPost) return;
    onPost?.(body);
    setDraft('');
  }, [canPost, body, onPost]);

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

      <ol className={styles.messages} aria-label="Comments" data-testid="thread-comments" />

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
