import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { QueryState } from '@tanstack/react-query';
import type { SiteMembers } from '@pantheon-systems/css-client';

import { useP1PuckOptional } from '../../core/P1PuckContext.js';
import { P1SdkQueryClientContext } from '../../data/query-provider.js';
import { useThreadsEnabled } from './enabled.js';
import { mentionCandidates, type MentionCandidate } from './mentions.js';

export const SITE_MEMBERS_KEY = 'p1-site-members';

const NO_CANDIDATES: readonly MentionCandidate[] = Object.freeze([]);

/** A roster changes rarely; one fetch serves a whole editing session. */
const FRESH_FOR_MS = 5 * 60_000;

const noop = () => {};

export function siteMembersKey(siteId: string | undefined) {
  return [SITE_MEMBERS_KEY, siteId] as const;
}

export interface SiteMembersState {
  /** Everyone who can be mentioned, agents first. Empty until the roster arrives. */
  candidates: readonly MentionCandidate[];
  loading: boolean;
}

/**
 * Who can be mentioned on this site. Nothing is asked for until `wanted`, so a thread
 * nobody types `@` in costs no request. Reads the query cache directly, like the rest
 * of the canvas-side thread UI, and answers "nobody" wherever there is nothing to
 * read from.
 */
export function useSiteMembers(wanted: boolean): SiteMembersState {
  const ccr = useP1PuckOptional();
  const queryClient = useContext(P1SdkQueryClientContext);
  const enabled = useThreadsEnabled();
  const client = ccr?.client;
  const siteId = ccr?.siteId;
  const ready = enabled && wanted && Boolean(client && siteId && queryClient);

  useEffect(() => {
    if (!ready || !queryClient || !client || !siteId) return;
    void queryClient.prefetchQuery({
      queryKey: siteMembersKey(siteId),
      queryFn: () => client.sites.members(siteId),
      staleTime: FRESH_FOR_MS,
    });
  }, [ready, queryClient, client, siteId]);

  const subscribe = useCallback(
    (onChange: () => void) => (queryClient ? queryClient.getQueryCache().subscribe(onChange) : noop),
    [queryClient],
  );
  const read = useCallback(
    (): QueryState<SiteMembers> | undefined =>
      queryClient?.getQueryCache().find<SiteMembers>({ queryKey: siteMembersKey(siteId) })?.state,
    [queryClient, siteId],
  );
  const state = useSyncExternalStore(subscribe, read, read);
  const roster = state?.data;

  const candidates = useMemo(() => (roster ? mentionCandidates(roster) : NO_CANDIDATES), [roster]);

  if (!ready) return { candidates: NO_CANDIDATES, loading: false };
  return { candidates, loading: roster === undefined && state?.status !== 'error' };
}
