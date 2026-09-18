/**
 * The threads on one page, keyed the way triggers look them up.
 *
 * The API answers with one overview per context on the page: the open thread when
 * there is one, otherwise the latest resolved one. Held as a map from `threadKey` so a
 * trigger for any kind of context reads its own entry without a search, and so a
 * change to one thread can be written back in place.
 */
import type { P1Client, ThreadOverview } from '@pantheon-systems/css-client';

import { threadKey } from './open-thread.js';

export const DOCUMENT_THREADS_KEY = 'p1-document-threads';

export type DocumentThreads = Readonly<Record<string, ThreadOverview>>;

export const NO_THREADS: DocumentThreads = Object.freeze({});

/** Every list a site returns, so a site with more contexts than one page can hold is still complete. */
const PAGE_SIZE = 500;

export function documentThreadsKey(siteId: string | undefined, documentId: string | undefined) {
  return [DOCUMENT_THREADS_KEY, siteId, documentId] as const;
}

export function overviewKey(thread: ThreadOverview): string {
  return threadKey(thread.context.type, thread.context.id);
}

export function indexThreads(threads: ThreadOverview[]): DocumentThreads {
  const byContext: Record<string, ThreadOverview> = {};
  for (const thread of threads) {
    byContext[overviewKey(thread)] = thread;
  }
  return byContext;
}

export async function fetchDocumentThreads(
  client: P1Client,
  siteId: string,
  documentId: string,
): Promise<DocumentThreads> {
  const threads: ThreadOverview[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.threads.listThreads(siteId, {
      documentId,
      limit: PAGE_SIZE,
      cursor,
    });
    threads.push(...page.threads);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return indexThreads(threads);
}
