import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Textarea } from '@pantheon-systems/pds-toolkit-react';

import {
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  serializeMentions,
  type MentionCandidate,
  type MentionQuery,
} from '../mentions.js';
import { MentionPicker, mentionOptionId } from './MentionPicker.js';
import styles from './CommentComposer.module.css';

export interface CommentComposerProps {
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
}

/** Typing pauses this long before `@` opens the picker, so a quick `@` in prose does not flash it. */
const MENTION_DEBOUNCE_MS = 150;

const NO_CANDIDATES: readonly MentionCandidate[] = [];

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
 * Where a new comment is written: a draft, the `@` mention picker over it, and the
 * Post button. Enter sends; Shift+Enter breaks the line.
 */
export function CommentComposer({
  onPost,
  posting = false,
  postFailed = false,
  mentionCandidates = NO_CANDIDATES,
}: CommentComposerProps): React.ReactElement {
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

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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

  return (
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
      <div className={styles.footer}>
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
  );
}
