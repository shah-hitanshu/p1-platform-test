import React, { useContext } from 'react';

import { P1SdkQueryClientContext } from '../../../data/query-provider.js';
import { useThreadsEnabled } from '../enabled.js';
import { useDocumentThreads } from '../use-document-threads.js';

function Loader(): null {
  useDocumentThreads();
  return null;
}

/**
 * Primes the current page's threads as soon as the editor is up, so the first block a
 * reader hovers already shows its count instead of fetching on demand.
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
