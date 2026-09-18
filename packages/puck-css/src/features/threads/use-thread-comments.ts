import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import type { QueryState } from '@tanstack/react-query';
import type { Comment, ThreadWithComments } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { useThreadsEnabled } from './enabled.js';
import { NO_COMMENTS, threadCommentsKey } from './thread-comments.js';

export interface ThreadCommentsState {
  /** Oldest first. Empty until the thread arrives. */
  comments: readonly Comment[];
  /** The thread is being asked for and nothing has come back yet. */
  loading: boolean;
  /** The thread could not be read, so the comments are unknown rather than absent. */
  failed: boolean;
  /** Ask for the thread again. */
  retry: () => void;
}

/** A thread reopened within this long is shown from memory instead of asked for again. */
const FRESH_FOR_MS = 30_000;

const noop = () => {};

const IDLE: ThreadCommentsState = { comments: NO_COMMENTS, loading: false, failed: false, retry: noop };

/**
 * Loads one thread's comments while the reader has it open.
 *
 * Nothing is asked for without a thread id, so a context nobody has commented on costs
 * no request, and a host can pass `undefined` to stand down while the view is closed.
 * Like the triggers, this may be mounted outside the editor's providers, so it reads the
 * query cache directly and answers "nothing" wherever there is nothing to read from.
 */
export function useThreadComments(threadId: string | undefined): ThreadCommentsState {
  const ccr = useP1PuckOptional();
  const queryClient = useContext(P1SdkQueryClientContext);
  const enabled = useThreadsEnabled();
  const client = ccr?.client;
  const siteId = ccr?.siteId;
  const ready = enabled && Boolean(client && siteId && threadId && queryClient);

  const fetchThread = useCallback(
    (staleTime: number) => {
      if (!queryClient || !client || !siteId || !threadId) return;
      void queryClient.prefetchQuery({
        queryKey: threadCommentsKey(siteId, threadId),
        queryFn: () => client.threads.getThread(siteId, threadId),
        staleTime,
      });
    },
    [queryClient, client, siteId, threadId],
  );

  useEffect(() => {
    if (ready) fetchThread(FRESH_FOR_MS);
  }, [ready, fetchThread]);

  const retry = useCallback(() => fetchThread(0), [fetchThread]);

  // A closed trigger, or one on a context with no thread, has nothing to listen for.
  const subscribe = useCallback(
    (onChange: () => void) => (ready && queryClient ? queryClient.getQueryCache().subscribe(onChange) : noop),
    [ready, queryClient],
  );
  const read = useCallback(
    (): QueryState<ThreadWithComments> | undefined =>
      queryClient?.getQueryCache().find<ThreadWithComments>({ queryKey: threadCommentsKey(siteId, threadId) })
        ?.state,
    [queryClient, siteId, threadId],
  );
  const state = useSyncExternalStore(subscribe, read, read);

  if (!ready) return IDLE;

  const fetching = state?.fetchStatus === 'fetching';
  return {
    comments: state?.data?.comments ?? NO_COMMENTS,
    loading: state?.data === undefined && (state === undefined || fetching),
    failed: state?.status === 'error' && !fetching,
    retry,
  };
}
