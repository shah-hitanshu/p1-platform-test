import { useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ThreadOverview } from '@pantheon-systems/css-client';

import { useP1Puck, useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext, useP1SdkQueryClient } from '../../data/query-provider.js';
import type { ThreadContextType } from './types.js';
import {
  documentThreadsKey,
  fetchDocumentThreads,
  NO_THREADS,
  type DocumentThreads,
} from './document-threads.js';
import { useThreadsEnabled } from './enabled.js';
import { threadKey } from './open-thread.js';

export interface DocumentThreadsState {
  /** Empty until the listing arrives, and for a page nobody has commented on. */
  threads: DocumentThreads;
  /** False while the listing is still in flight, which an empty map alone doesn't tell you. */
  loaded: boolean;
  /** The listing could not be read, so the threads are unknown rather than absent. */
  failed: boolean;
  /** Ask for the listing again. */
  retry: () => void;
}

/**
 * Loads the threads on the current page and keeps them for as long as it is open.
 *
 * Nothing is asked for until threads are on and a document is loaded. Switching
 * documents asks for the new page's threads; switching branches asks again for the
 * same page. Threads are not branch-scoped, so that second refetch is a cheap check
 * that nothing has drifted rather than a correctness need.
 */
export function useDocumentThreads(): DocumentThreadsState {
  const { client, siteId, branchId, currentDocument } = useP1Puck();
  const documentId = currentDocument?.id;
  const enabled = useThreadsEnabled();
  const queryClient = useP1SdkQueryClient();
  const queryKey = useMemo(() => documentThreadsKey(siteId, documentId), [siteId, documentId]);

  const query = useQuery(
    {
      queryKey,
      queryFn: async (): Promise<DocumentThreads> => {
        if (!documentId) return NO_THREADS;
        return fetchDocumentThreads(client, siteId, documentId);
      },
      enabled: enabled && documentId !== undefined,
    },
    queryClient,
  );

  const seenBranch = useRef(branchId);
  useEffect(() => {
    if (seenBranch.current === branchId) return;
    seenBranch.current = branchId;
    void queryClient.invalidateQueries({ queryKey });
  }, [branchId, queryClient, queryKey]);

  const refetch = query.refetch;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    threads: query.data ?? NO_THREADS,
    loaded: query.isSuccess || query.isError,
    failed: query.isError,
    retry,
  };
}

const noop = () => {};

/**
 * The thread already on one context, read from whatever the loader has fetched.
 *
 * Triggers are drawn in the block overlays, which a host may render without the
 * editor's providers around them, so this reads the cache directly and answers
 * "none" wherever there is nothing to read from.
 */
export function useThreadOverview(
  contextType: ThreadContextType,
  contextId: string,
): ThreadOverview | undefined {
  const ccr = useP1PuckOptional();
  const queryClient = useContext(P1SdkQueryClientContext);
  const enabled = useThreadsEnabled();
  const siteId = ccr?.siteId;
  const documentId = ccr?.currentDocument?.id;
  const key = threadKey(contextType, contextId);

  const subscribe = useCallback(
    (onChange: () => void) => (queryClient ? queryClient.getQueryCache().subscribe(onChange) : noop),
    [queryClient],
  );
  const read = useCallback(
    () => queryClient?.getQueryData<DocumentThreads>(documentThreadsKey(siteId, documentId))?.[key],
    [queryClient, siteId, documentId, key],
  );

  const thread = useSyncExternalStore(subscribe, read, read);
  // Turning threads off hides the threads too; the cache may still hold them.
  return enabled ? thread : undefined;
}
