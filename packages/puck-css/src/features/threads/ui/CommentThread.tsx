import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Icon, Spinner, Textarea } from '@pantheon-systems/pds-toolkit-react';
import type { Comment } from '@pantheon-systems/css-client';

import { SafeIcon } from '../../../pds/components/SafeIcon.js';
import type { ThreadContext, ThreadSubject } from '../types.js';
import { useKeepInView } from '../use-keep-in-view.js';
import {
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  serializeMentions,
  type MentionCandidate,
  type MentionQuery,
} from '../mentions.js';
import { CommentList } from './CommentList.js';
import { MentionPicker, mentionOptionId } from './MentionPicker.js';
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
  onClose: () => void;
}

/** Typing pauses this long before `@` opens the picker, so a quick `@` in prose does not flash it. */
const MENTION_DEBOUNCE_MS = 150;

const NO_CANDIDATES: readonly MentionCandidate[] = [];

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
 * The mention being typed, a beat after the typing stops. Once the picker is open it
 * follows every keystroke, so filtering feels immediate; only the opening waits.
 */
function useMentionQuery(draft: string, caret: number): MentionQuery | null {
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const open = mention !== null;

  useEffect(() => {
    const next = mentionQueryAt(draft, caret);
    const apply = () =>
      setMention((prev) =>
        prev && next && prev.start === next.start && prev.end === next.end && prev.query === next.query
          ? prev
          : next,
      );
    if (next === null || open) {
      apply();
      return;
    }
    const timer = setTimeout(apply, MENTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` only decides whether to wait
  }, [draft, caret]);

  return mention;
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
  mentionCandidates = NO_CANDIDATES,
  onClose,
}: CommentThreadProps): React.ReactElement {
  const draftId = useId();
  const pickerId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [chosen, setChosen] = useState<readonly MentionCandidate[]>([]);
  const body = draft.trim();
  const canPost = body.length > 0 && !posting;

  const mention = useMentionQuery(draft, caret);
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  const matches = useMemo(
    () => (mention ? filterMentionCandidates(mentionCandidates, mention.query) : []),
    [mention, mentionCandidates],
  );
  const pickerOpen = mention !== null && !dismissed && matches.length > 0;
  const activeIndex = Math.min(highlighted, Math.max(matches.length - 1, 0));
  const activeCandidate = pickerOpen ? matches[activeIndex] : undefined;

  useEffect(() => {
    setHighlighted(0);
    setDismissed(false);
  }, [mention?.query, mention?.start]);

  useLayoutEffect(() => {
    if (pendingCaret === null) return;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret]);

  const selectMention = useCallback(
    (candidate: MentionCandidate) => {
      if (!mention) return;
      const next = insertMention(draft, mention, candidate);
      setDraft(next.text);
      setCaret(next.caret);
      setPendingCaret(next.caret);
      setChosen((prev) =>
        prev.some((c) => c.type === candidate.type && c.id === candidate.id) ? prev : [...prev, candidate],
      );
    },
    [draft, mention],
  );

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const clearDraft = useCallback(() => {
    setDraft('');
    setCaret(0);
    setChosen([]);
  }, []);

  const post = useCallback(() => {
    if (!canPost) return;
    // Only what was sent is cleared; anything typed while the post was in flight stays.
    const sent = draft;
    const clearSent = () => {
      if (draftRef.current === sent) clearDraft();
    };
    const result = onPost?.(serializeMentions(body, chosen));
    if (result instanceof Promise) {
      void result.then((landed) => {
        if (landed !== false) clearSent();
      });
    } else {
      clearSent();
    }
  }, [canPost, draft, body, chosen, onPost, clearDraft]);

  const onDraftKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isEditingKey(e)) e.stopPropagation();
    if (pickerOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : matches.length - 1;
        setHighlighted((activeIndex + step) % matches.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        if (activeCandidate) selectMention(activeCandidate);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        return;
      }
    }
    if (isPostShortcut(e)) {
      e.preventDefault();
      post();
    }
  };

  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
  };

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
        {pickerOpen && (
          <MentionPicker
            id={pickerId}
            candidates={matches}
            highlighted={activeIndex}
            onHighlight={setHighlighted}
            onSelect={selectMention}
          />
        )}
        <Textarea
          ref={textareaRef}
          id={draftId}
          label="New comment"
          showLabel={false}
          placeholder="Reply or @mention"
          rows={2}
          size="s"
          className={styles.draft}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            trackCaret(e);
          }}
          textareaProps={{
            onKeyDown: onDraftKeyDown,
            onKeyUp: trackCaret,
            onClick: trackCaret,
            'aria-autocomplete': 'list',
            'aria-controls': pickerOpen ? pickerId : undefined,
            'aria-activedescendant': activeCandidate ? mentionOptionId(pickerId, activeCandidate) : undefined,
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
