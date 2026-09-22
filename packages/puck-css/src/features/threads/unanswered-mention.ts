/**
 * Counting the mentions a thread tells its reader went unanswered.
 *
 * The line saying an agent never replied is worked out from the clock as the thread
 * renders, so it exists only on screen. Each one a reader is shown is reported once, to
 * the site's own backend, as three ids and how long the reader waited.
 */
import { useEffect } from 'react';
import type { Comment } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';

/** A failure counts while the turn it belongs to is still live; an old thread reopened is not news. */
const FRESH_FAILURE_MS = 60_000;

/** Far more stand-ins than one reading session can produce, so the ledger cannot grow without end. */
const MAX_REPORTED = 500;

const reported = new Set<string>();

export function resetUnansweredMentionReports(): void {
  reported.clear();
}

interface UnansweredMention {
  /** Stable across renders and mounts, so the same failure is reported once however often it is drawn. */
  key: string;
  commentId: string;
  agentId: string;
  elapsedMs: number;
}

/**
 * Which of the stand-ins on screen are telling the reader an agent never replied.
 *
 * Takes the comments as loaded and the same list with stand-ins added, rather than
 * recognising a stand-in by its shape: the rule for when one turns from working to
 * failed then stays in the one place that owns it.
 */
export function unansweredMentions(
  comments: readonly Comment[],
  shown: readonly Comment[],
  now: number,
): UnansweredMention[] {
  const ask = comments[comments.length - 1];
  if (!ask) return [];
  const elapsedMs = Math.max(0, now - Date.parse(ask.createdAt));
  if (Number.isNaN(elapsedMs) || elapsedMs >= FRESH_FAILURE_MS) return [];
  const loaded = new Set(comments.map((comment) => comment.id));
  return shown
    .filter((standIn) => !loaded.has(standIn.id) && standIn.metadata?.status === 'failed')
    .map((standIn) => ({ key: standIn.id, commentId: ask.id, agentId: standIn.author.id, elapsedMs }));
}

/**
 * Reports each unanswered mention the reader is shown, once.
 *
 * A thread can be open in more than one place at a time, so the ledger of what has been
 * reported is module-wide and a key goes in before the request goes out: whichever copy
 * of the hook gets there first is the one that reports.
 */
export function useUnansweredMentionReport(
  threadId: string | undefined,
  comments: readonly Comment[] | undefined,
  shown: readonly Comment[],
): void {
  const ccr = useP1PuckOptional();
  const client = ccr?.client;
  const siteId = ccr?.siteId;

  useEffect(() => {
    if (!threadId || !comments || !client || !siteId) return;
    const mentions = unansweredMentions(comments, shown, Date.now());
    if (reported.size + mentions.length > MAX_REPORTED) reported.clear();
    for (const mention of mentions) {
      if (reported.has(mention.key)) continue;
      reported.add(mention.key);
      try {
        void client.threads
          .reportUnansweredMention(siteId, threadId, {
            commentId: mention.commentId,
            agentId: mention.agentId,
            elapsedMs: mention.elapsedMs,
          })
          .catch(() => {});
      } catch {
        // A count nobody is waiting for must never be what breaks the thread view.
      }
    }
  }, [threadId, comments, shown, client, siteId]);
}
