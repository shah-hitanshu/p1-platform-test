/**
 * Upstream site roster memo.
 *
 * The whole value of this module is that it does not call upstream twice, and
 * that a failed call falls back to what it already had — so the assertions are
 * about call counts and reported sources, not about the roster contents.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MASClient } from '../../src/services/mas-client';
import {
  getSiteRoster,
  resetSiteRosterCacheForTests,
} from '../../src/services/mas-roster-cache';

function client(
  impl: () => Promise<{ userId: string; role: 'admin' }[] | null>,
): { client: MASClient; getSiteMemberships: ReturnType<typeof vi.fn> } {
  const getSiteMemberships = vi.fn(impl);
  return { client: { getSiteMemberships } as unknown as MASClient, getSiteMemberships };
}

const roster = [{ userId: 'user-1', role: 'admin' as const }];

describe('getSiteRoster', () => {
  beforeEach(() => {
    resetSiteRosterCacheForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads upstream on a cold memo', async () => {
    const { client: mas, getSiteMemberships } = client(async () => roster);

    const result = await getSiteRoster('site-1', mas);

    expect(result).toEqual({ roster, source: 'upstream', ageMs: 0 });
    expect(getSiteMemberships).toHaveBeenCalledTimes(1);
  });

  it('answers a second call from the memo without calling upstream', async () => {
    const { client: mas, getSiteMemberships } = client(async () => roster);

    await getSiteRoster('site-1', mas);
    vi.advanceTimersByTime(30_000);
    const second = await getSiteRoster('site-1', mas);

    expect(getSiteMemberships).toHaveBeenCalledTimes(1);
    expect(second.source).toBe('memo');
    expect(second.ageMs).toBe(30_000);
    expect(second.roster).toEqual(roster);
  });

  it('goes back upstream once the memo is no longer fresh', async () => {
    const { client: mas, getSiteMemberships } = client(async () => roster);

    await getSiteRoster('site-1', mas);
    vi.advanceTimersByTime(61_000);
    const second = await getSiteRoster('site-1', mas);

    expect(getSiteMemberships).toHaveBeenCalledTimes(2);
    expect(second.source).toBe('upstream');
  });

  it('memoizes per site', async () => {
    const { client: mas, getSiteMemberships } = client(async () => roster);

    await getSiteRoster('site-1', mas);
    await getSiteRoster('site-2', mas);

    expect(getSiteMemberships).toHaveBeenCalledTimes(2);
    expect(getSiteMemberships).toHaveBeenNthCalledWith(1, 'site-1');
    expect(getSiteMemberships).toHaveBeenNthCalledWith(2, 'site-2');
  });

  it('serves a stale memo when upstream fails', async () => {
    let fail = false;
    const { client: mas } = client(async () => (fail ? null : roster));

    await getSiteRoster('site-1', mas);
    fail = true;
    vi.advanceTimersByTime(120_000);
    const result = await getSiteRoster('site-1', mas);

    expect(result.source).toBe('stale');
    expect(result.roster).toEqual(roster);
    expect(result.ageMs).toBe(120_000);
  });

  it('stops serving a memo that has aged past the stale grace window', async () => {
    let fail = false;
    const { client: mas } = client(async () => (fail ? null : roster));

    await getSiteRoster('site-1', mas);
    fail = true;
    vi.advanceTimersByTime(700_000);
    const result = await getSiteRoster('site-1', mas);

    expect(result).toEqual({ roster: null, source: 'unavailable', ageMs: 0 });
  });

  it('reports unavailable when upstream fails with nothing memoized', async () => {
    const { client: mas } = client(async () => null);

    const result = await getSiteRoster('site-1', mas);

    expect(result).toEqual({ roster: null, source: 'unavailable', ageMs: 0 });
  });

  it('collapses concurrent misses into one upstream read', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client: mas, getSiteMemberships } = client(async () => {
      await gate;
      return roster;
    });

    const both = Promise.all([getSiteRoster('site-1', mas), getSiteRoster('site-1', mas)]);
    release();
    const [first, second] = await both;

    expect(getSiteMemberships).toHaveBeenCalledTimes(1);
    expect(first.roster).toEqual(roster);
    expect(second.roster).toEqual(roster);
  });

  it('does not hold a finished read against the next caller', async () => {
    const { client: mas, getSiteMemberships } = client(async () => roster);

    await getSiteRoster('site-1', mas);
    vi.advanceTimersByTime(61_000);
    await getSiteRoster('site-1', mas);

    expect(getSiteMemberships).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown upstream read as a failure rather than propagating it', async () => {
    const { client: mas } = client(async () => {
      throw new Error('socket hang up');
    });

    const result = await getSiteRoster('site-1', mas);

    expect(result).toEqual({ roster: null, source: 'unavailable', ageMs: 0 });
  });

  it('serves a stale memo when the upstream read throws', async () => {
    let fail = false;
    const { client: mas } = client(async () => {
      if (fail) throw new Error('socket hang up');
      return roster;
    });

    await getSiteRoster('site-1', mas);
    fail = true;
    vi.advanceTimersByTime(120_000);
    const result = await getSiteRoster('site-1', mas);

    expect(result.source).toBe('stale');
    expect(result.roster).toEqual(roster);
  });

  it('does not memoize a failed read', async () => {
    let fail = true;
    const { client: mas, getSiteMemberships } = client(async () => (fail ? null : roster));

    await getSiteRoster('site-1', mas);
    fail = false;
    const second = await getSiteRoster('site-1', mas);

    expect(getSiteMemberships).toHaveBeenCalledTimes(2);
    expect(second.source).toBe('upstream');
  });

  it('bounds the memo, evicting the least recently stored site', async () => {
    const { client: mas, getSiteMemberships } = client(async () => roster);

    for (let i = 0; i < 201; i++) {
      await getSiteRoster(`site-${String(i)}`, mas);
    }
    getSiteMemberships.mockClear();

    // The first site was evicted; the last one is still memoized.
    const evicted = await getSiteRoster('site-0', mas);
    const kept = await getSiteRoster('site-200', mas);

    expect(evicted.source).toBe('upstream');
    expect(kept.source).toBe('memo');
    expect(getSiteMemberships).toHaveBeenCalledTimes(1);
  });
});
