import React, { useContext, useEffect } from 'react';

import { useP1Puck } from '../../../core/P1PuckContext.js';
import { P1SdkQueryClientContext, useP1SdkQueryClient } from '../../../data/query-provider.js';
import { documentThreadsKey } from '../document-threads.js';
import { useThreadsEnabled } from '../enabled.js';
import {
  subscribeToThreadEvents,
  subscribeToThreadsReconnect,
} from '../realtime-events.js';
import { applyThreadEvent } from '../thread-cache.js';
import { useDocumentThreads } from '../use-document-threads.js';

function Loader(): null {
  useDocumentThreads();
  const queryClient = useP1SdkQueryClient();
  const { siteId, currentDocument } = useP1Puck();
  const documentId = currentDocument?.id;

  useEffect(
    () => subscribeToThreadEvents((event) => {
      applyThreadEvent(queryClient, event);
    }),
    [queryClient],
  );

  useEffect(
    () => subscribeToThreadsReconnect(() => {
      void queryClient.invalidateQueries({ queryKey: documentThreadsKey(siteId, documentId) });
    }),
    [queryClient, siteId, documentId],
  );

  return null;
}

/**
 * Primes the current page's threads as soon as the editor is up, so the first block a
 * reader hovers already shows its count instead of fetching on demand, and folds in
 * changes pushed from other editors for as long as the page is open.
 *
 * Renders nothing. Mounted where it outlives any one block overlay, and only once
 * threads are on, so a reader without the feature makes no request.
 */
export function DocumentThreadsLoader(): React.ReactElement | null {
  const enabled = useThreadsEnabled();
  const queryClient = useContext(P1SdkQueryClientContext);
  if (!enabled || queryClient === null) return null;
  return <Loader />;
}
