import type { QueryClient } from '@tanstack/react-query';
import type { ThreadEvent, ThreadOverview } from '@pantheon-systems/css-client';

import { documentThreadsKey, overviewKey, type DocumentThreads } from './document-threads.js';
import { appendThreadComment } from './thread-comments.js';

/**
 * Writes one thread's latest overview into its page's loaded listing.
 *
 * This is the seam every source of change comes through: a comment this reader just
 * posted, and later a change pushed from another reader. A page whose listing has not
 * been loaded is left alone, since writing one thread into an empty map would stand in
 * for a listing that was never fetched.
 *
 * @returns Whether a loaded listing was there to update.
 */
export function applyThreadOverview(queryClient: QueryClient, thread: ThreadOverview): boolean {
  if (thread.documentId === null) return false;
  const key = documentThreadsKey(thread.siteId, thread.documentId);
  const loaded = queryClient.getQueryData<DocumentThreads>(key);
  if (loaded === undefined) return false;
  queryClient.setQueryData<DocumentThreads>(key, { ...loaded, [overviewKey(thread)]: thread });
  return true;
}

/**
 * Folds a change to a thread into the page listing it belongs to, and a new or
 * rewritten comment into its thread as well when that thread is open.
 *
 * @returns Whether anything loaded was there to update.
 */
export function applyThreadEvent(queryClient: QueryClient, event: ThreadEvent): boolean {
  switch (event.type) {
    case 'comment_posted':
    case 'comment_updated': {
      const listed = applyThreadOverview(queryClient, event.thread);
      const appended = appendThreadComment(queryClient, event.siteId, event.comment);
      return listed || appended;
    }
    case 'thread_status_changed':
      return applyThreadOverview(queryClient, event.thread);
  }
}
