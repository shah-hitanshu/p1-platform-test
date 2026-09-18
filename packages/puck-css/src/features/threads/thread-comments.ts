/**
 * One thread with everything said in it, held for as long as the reader has it open.
 *
 * Comments are kept in the order they were posted, oldest first, the way the API
 * returns them. A comment that arrives later, whether this reader posted it or someone
 * else did, is slotted in by its time rather than tacked on the end, so two writers
 * posting at once read the same way to both of them.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Comment, ThreadWithComments } from '@pantheon-systems/css-client';

export const THREAD_COMMENTS_KEY = 'p1-thread-comments';

export const NO_COMMENTS: readonly Comment[] = Object.freeze([]);

export function threadCommentsKey(siteId: string | undefined, threadId: string | undefined) {
  return [THREAD_COMMENTS_KEY, siteId, threadId] as const;
}

export function insertComment(comments: readonly Comment[], comment: Comment): readonly Comment[] {
  if (comments.some((c) => c.id === comment.id)) return comments;
  const at = comments.findIndex((c) => c.createdAt > comment.createdAt);
  if (at === -1) return [...comments, comment];
  return [...comments.slice(0, at), comment, ...comments.slice(at)];
}

/** Puts a whole thread in place, as when the reader has just started it. */
export function storeThread(queryClient: QueryClient, thread: ThreadWithComments): void {
  queryClient.setQueryData<ThreadWithComments>(
    threadCommentsKey(thread.thread.siteId, thread.thread.id),
    thread,
  );
}

/**
 * Adds one comment to its thread, if that thread has been loaded. A thread nobody has
 * opened is left alone: one comment would stand in for a thread never fetched.
 *
 * @returns Whether a loaded thread was there to add to.
 */
export function appendThreadComment(queryClient: QueryClient, siteId: string, comment: Comment): boolean {
  const key = threadCommentsKey(siteId, comment.threadId);
  const loaded = queryClient.getQueryData<ThreadWithComments>(key);
  if (loaded === undefined) return false;
  const comments = insertComment(loaded.comments, comment);
  if (comments === loaded.comments) return true;
  queryClient.setQueryData<ThreadWithComments>(key, { ...loaded, comments: [...comments] });
  return true;
}
