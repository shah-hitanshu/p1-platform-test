import { useCallback, useContext, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import type { QueryState } from '@tanstack/react-query';
import { isAgentWorking, type Comment, type ThreadWithComments } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { useThreadsEnabled } from './enabled.js';
import { pendingAgentDeadline, withPendingAgents } from './pending-agent.js';
import { NO_COMMENTS, threadCommentsKey } from './thread-comments.js';
import { subscribeToQueryCache } from './query-cache.js';
import { useUnansweredMentionReport } from './unanswered-mention.js';

export interface ThreadCommentsState {
  /**
   * Oldest first. Empty until the thread arrives. An agent the latest comment mentions
   * is shown as working until it speaks for itself, or as failed once it has taken too
   * long to start.
   */
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

/** How often to ask again while an agent is at work in the thread. */
const POLL_MS = 2_500;

/** How long to keep asking after an agent was mentioned and has not yet picked it up. */
const AWAIT_AGENT_MS = 60_000;

/** How long an agent's working line keeps the thread asking; one older than this belongs to a turn that died. */
const AGENT_WORKING_MS = 3 * 60_000;

/**
 * Whether the thread is waiting on an agent: one has said it is working, or the latest
 * comment mentions one and nothing has come back yet. Nothing pushes changes into the
 * canvas, so while this holds the thread is asked for again on a short clock. Both
 * conditions run out, so a turn that never finished does not keep the thread polling.
 */
export function awaitingAgent(comments: readonly Comment[], now: number): boolean {
  if (comments.some((c) => isAgentWorking(c) && now - Date.parse(c.createdAt) < AGENT_WORKING_MS)) return true;
  const last = comments[comments.length - 1];
  if (!last || last.author.type !== 'user' || !last.mentions.some((m) => m.type === 'agent')) return false;
  return now - Date.parse(last.createdAt) < AWAIT_AGENT_MS;
}

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
    (onChange: () => void) => (ready && queryClient ? subscribeToQueryCache(queryClient, onChange) : noop),
    [ready, queryClient],
  );
  const read = useCallback(
    (): QueryState<ThreadWithComments> | undefined =>
      queryClient?.getQueryCache().find<ThreadWithComments>({ queryKey: threadCommentsKey(siteId, threadId) })
        ?.state,
    [queryClient, siteId, threadId],
  );
  const state = useSyncExternalStore(subscribe, read, read);

  // The cache drops a query nothing observes, and this hook only reads, so a thread left
  // open long enough loses its comments; asking again when that happens brings it back.
  const gone = state === undefined;
  useEffect(() => {
    if (ready && gone) fetchThread(FRESH_FOR_MS);
  }, [ready, gone, fetchThread]);

  const comments = state?.data?.comments;
  const polling = ready && comments !== undefined && awaitingAgent(comments, Date.now());
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => fetchThread(0), POLL_MS);
    return () => clearInterval(timer);
  }, [polling, fetchThread]);

  // The stand-in for a mentioned agent is read off the clock, so this wakes the hook at
  // the moment it should turn from working to failed.
  const [tick, wake] = useReducer((n: number) => n + 1, 0);
  const deadline = ready && comments ? pendingAgentDeadline(comments, Date.now()) : null;
  useEffect(() => {
    if (deadline === null) return;
    const timer = setTimeout(wake, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);
  const shown = useMemo(
    () => (comments ? withPendingAgents(comments, Date.now()) : NO_COMMENTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` stands for the clock having moved
    [comments, tick],
  );
  useUnansweredMentionReport(ready ? threadId : undefined, comments, shown);

  if (!ready) return IDLE;

  const fetching = state?.fetchStatus === 'fetching';
  return {
    comments: shown,
    loading: state?.data === undefined && (state === undefined || fetching),
    failed: state?.status === 'error' && !fetching,
    retry,
  };
}
