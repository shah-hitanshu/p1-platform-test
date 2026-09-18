import { useCallback, useContext, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ThreadContextType, P1Client, PostCommentResult } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { applyThreadOverview } from './thread-cache.js';
import { appendThreadComment, storeThread } from './thread-comments.js';

export interface UsePostCommentOptions {
  contextType: ThreadContextType;
  contextId: string;
  /** The thread to add to. Absent starts one on the context. */
  threadId?: string;
}

export interface PostCommentState {
  /**
   * Sends the comment and resolves to whether it landed. Absent where there is no
   * editor to send it through.
   */
  post?: (body: string) => Promise<boolean>;
  posting: boolean;
  failed: boolean;
}

const NEEDS_DOCUMENT: ReadonlySet<ThreadContextType> = new Set(['block', 'page']);

interface Target {
  contextType: ThreadContextType;
  contextId: string;
  threadId?: string;
  documentId?: string;
  branchId?: string;
}

/** Adds to the thread when there is one, else starts one on the context. */
function sendComment(
  client: P1Client,
  siteId: string,
  { contextType, contextId, threadId, documentId, branchId }: Target,
  body: string,
): Promise<PostCommentResult> {
  if (threadId) return client.threads.postComment(siteId, threadId, body);
  return client.threads.postThread(siteId, {
    context: { type: contextType, id: contextId },
    documentId: NEEDS_DOCUMENT.has(contextType) ? documentId : undefined,
    branchId,
    body: body,
  });
}

/** Writes what was posted back where it is already shown: the listing and the open thread. */
function rememberPosted(
  queryClient: QueryClient,
  siteId: string,
  threadId: string | undefined,
  result: PostCommentResult,
): void {
  applyThreadOverview(queryClient, result.thread);
  if (threadId) appendThreadComment(queryClient, siteId, result.comment);
  else storeThread(queryClient, { thread: result.thread, comments: [result.comment] });
}

/**
 * Posts a comment on one context and writes it back where it is already shown: the
 * thread it lands in goes into the page's loaded listing, so the trigger's count moves,
 * and the comment goes into the open thread, so it appears without another fetch.
 *
 * A comment on a resolved thread reopens it, so a known thread is always posted to
 * directly; only a context with no thread yet starts one.
 */
export function usePostComment({ contextType, contextId, threadId }: UsePostCommentOptions): PostCommentState {
  const ccr = useP1PuckOptional();
  const queryClient = useContext(P1SdkQueryClientContext);
  const client = ccr?.client;
  const siteId = ccr?.siteId;
  const branchId = ccr?.branchId ?? undefined;
  const documentId = ccr?.currentDocument?.id;
  const [posting, setPosting] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = Boolean(client && siteId && (!NEEDS_DOCUMENT.has(contextType) || documentId));

  const post = useCallback(
    async (body: string) => {
      if (!client || !siteId) return false;
      setPosting(true);
      setFailed(false);
      try {
        const target = { contextType, contextId, threadId, documentId, branchId };
        const result = await sendComment(client, siteId, target, body);
        if (queryClient) rememberPosted(queryClient, siteId, threadId, result);
        return true;
      } catch {
        setFailed(true);
        return false;
      } finally {
        setPosting(false);
      }
    },
    [client, siteId, threadId, contextType, contextId, documentId, branchId, queryClient],
  );

  return { post: ready ? post : undefined, posting, failed };
}
