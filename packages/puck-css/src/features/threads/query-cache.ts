import { notifyManager, type QueryClient } from '@tanstack/react-query';

/**
 * Listens to the whole query cache and answers after the current render.
 *
 * The cache tells its listeners about every change synchronously, including the ones a
 * component causes while it is rendering, such as building its first query. A reader
 * whose snapshot has changed but not yet re-rendered would be forced to update from
 * inside that other component's render. Deferring through the notify manager lands the
 * notice afterwards, the way the cache's own observers hear about changes.
 */
export function subscribeToQueryCache(queryClient: QueryClient, onChange: () => void): () => void {
  return queryClient.getQueryCache().subscribe(notifyManager.batchCalls(onChange));
}
