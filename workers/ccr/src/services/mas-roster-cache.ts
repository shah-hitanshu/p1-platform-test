/**
 * Short-lived memo of the upstream site roster.
 *
 * A site's membership costs a paged HTTP round trip and is the same answer for
 * every viewer. Kept isolate-local rather than in KV: no binding, no
 * invalidation protocol, and a cold isolate is the behaviour we had before it.
 * Serving a minute-stale list is safe because authorization does not read it.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { PantheonRole } from '../types';
import type { MASClient } from './mas-client';

export type SiteRoster = { userId: string; role: PantheonRole }[];

/** 'stale' is a served answer: upstream failed, a recent memo covered for it. */
export type RosterSource = 'upstream' | 'memo' | 'stale' | 'unavailable';

export interface RosterResult {
  roster: SiteRoster | null;
  source: RosterSource;
  /** Age of the served memo in ms; 0 for a fresh upstream read. */
  ageMs: number;
}

const FRESH_MS = 60_000;

/** How far past FRESH_MS a memo may still answer for a failed upstream call. */
const STALE_GRACE_MS = 600_000;

/** Bounds the memo in a long-lived isolate serving many sites. */
const MAX_ENTRIES = 200;

interface Entry {
  roster: SiteRoster;
  storedAt: number;
}

const entries = new Map<string, Entry>();

/** Upstream reads in flight, so N viewers arriving on a cold site make one call. */
const inFlight = new Map<string, Promise<SiteRoster | null>>();

function store(siteId: string, roster: SiteRoster): void {
  // Map iterates in insertion order, so delete before set to move a refreshed
  // site to the back and keep the first key the oldest write.
  entries.delete(siteId);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done !== true) entries.delete(oldest.value);
  }
  entries.set(siteId, { roster, storedAt: Date.now() });
}

/**
 * The site's upstream roster, from the memo when it is fresh enough.
 *
 * Never throws: an upstream failure comes back as a stale roster if one is on
 * hand, and otherwise as `{ roster: null, source: 'unavailable' }`.
 */
export async function getSiteRoster(
  siteId: string,
  masClient: MASClient,
): Promise<RosterResult> {
  const cached = entries.get(siteId);
  const now = Date.now();

  if (cached !== undefined && now - cached.storedAt < FRESH_MS) {
    return { roster: cached.roster, source: 'memo', ageMs: now - cached.storedAt };
  }

  const roster = await readUpstreamOnce(siteId, masClient);

  if (roster !== null) {
    store(siteId, roster);
    return { roster, source: 'upstream', ageMs: 0 };
  }

  if (cached !== undefined && now - cached.storedAt < STALE_GRACE_MS) {
    getLogger().warn('site roster: upstream unavailable, serving a stale memo', {
      site_id: siteId,
      age_ms: now - cached.storedAt,
      outcome: 'degraded',
    });
    return { roster: cached.roster, source: 'stale', ageMs: now - cached.storedAt };
  }

  return { roster: null, source: 'unavailable', ageMs: 0 };
}

/**
 * The read between a memo miss and the store that follows it, shared by every
 * caller that arrives while it is outstanding — the busy-site case the memo
 * exists for is exactly the one where they all miss at once. Safe to share
 * because readUpstream resolves rather than rejecting, so waiters cannot be
 * failed by each other.
 */
function readUpstreamOnce(siteId: string, masClient: MASClient): Promise<SiteRoster | null> {
  const existing = inFlight.get(siteId);
  if (existing !== undefined) return existing;

  const pending = readUpstream(siteId, masClient).finally(() => inFlight.delete(siteId));
  inFlight.set(siteId, pending);

  return pending;
}

/**
 * MASClient catches its own fetch errors today; owning the catch here keeps the
 * never-throw contract above from depending on that.
 */
async function readUpstream(siteId: string, masClient: MASClient): Promise<SiteRoster | null> {
  try {
    return await masClient.getSiteMemberships(siteId);
  } catch (error) {
    getLogger().error('site roster: upstream read threw', error, {
      site_id: siteId,
      outcome: 'degraded',
    });
    return null;
  }
}

/** Test seam: drops every memo so one test's roster cannot answer the next one's call. */
export function resetSiteRosterCacheForTests(): void {
  entries.clear();
  inFlight.clear();
}
