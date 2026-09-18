import { useCallback, useContext, useState } from 'react';
import type { ThreadStatus } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { applyThreadOverview } from './thread-cache.js';

export interface UseThreadStatusOptions {
  threadId?: string;
}

export interface ThreadStatusState {
  /**
   * Marks the discussion over and resolves to whether that landed. Absent where there
   * is no thread to resolve yet, or no editor to send it through.
   */
  resolve?: () => Promise<boolean>;
  /** Reopens a resolved thread. Absent on the same terms as `resolve`. */
  reopen?: () => Promise<boolean>;
  /** A change of status is in flight. */
  saving: boolean;
  /** The last change of status did not land. */
  failed: boolean;
}

/**
 * Resolving a thread, and reopening one that was resolved.
 *
 * Anyone who can comment can do either, so the thread view offers it to every reader
 * rather than to whoever started the discussion. The thread that comes back goes into
 * the page's loaded listing, so the trigger and the header agree on the new status
 * without another fetch.
 */
export function useThreadStatus({ threadId }: UseThreadStatusOptions): ThreadStatusState {
  const ccr = useP1PuckOptional();
  const queryClient = useContext(P1SdkQueryClientContext);
  const client = ccr?.client;
  const siteId = ccr?.siteId;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const setStatus = useCallback(
    async (status: ThreadStatus) => {
      if (!client || !siteId || !threadId) return false;
      setSaving(true);
      setFailed(false);
      try {
        const thread = await client.threads.setThreadStatus(siteId, threadId, status);
        if (queryClient) applyThreadOverview(queryClient, thread);
        return true;
      } catch {
        setFailed(true);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [client, siteId, threadId, queryClient],
  );

  const resolve = useCallback(() => setStatus('resolved'), [setStatus]);
  const reopen = useCallback(() => setStatus('open'), [setStatus]);

  const ready = Boolean(client && siteId && threadId);
  return { resolve: ready ? resolve : undefined, reopen: ready ? reopen : undefined, saving, failed };
}
