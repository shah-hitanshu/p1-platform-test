/**
 * Purge observability.
 *
 * cache.purge() reports failure in its result rather than rejecting, so these
 * log lines are the only evidence a purge did not happen — and a purge that
 * did not happen means indefinitely stale published content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cache } from 'cloudflare:workers';
import { purgeContentCache } from '../../src/cache/purge';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

const SITE_ID = 'site-123';
const BRANCH_ID = 'branch-main';

const purgeSpy = vi.spyOn(cache, 'purge');

beforeEach(() => {
  vi.clearAllMocks();
  purgeSpy.mockResolvedValue({ success: true, errors: [] });
});

describe('purge logging', () => {
  it('records the site and branch it purged', async () => {
    await purgeContentCache({ siteId: SITE_ID, branchId: BRANCH_ID });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [, fields] = logger.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.site_id).toBe(SITE_ID);
    expect(fields.branch_id).toBe(BRANCH_ID);
    expect(fields.outcome).toBe('success');
    expect(fields.count).toBe(1);
  });

  // Site-wide by design: page lists on inheriting branches and cached 404s
  // carry no doc tag, so a narrower purge would leave them stale. branchId and
  // documentId are log context, not purge scope.
  it('purges the site tag alone even when a branch and document are named', async () => {
    await purgeContentCache({
      siteId: SITE_ID,
      branchId: BRANCH_ID,
      documentId: 'doc-1',
    });

    expect(purgeSpy).toHaveBeenCalledWith({ tags: [`site:${SITE_ID}`] });
  });

  // The failure path is silent at the API level, so it must be loud in logs.
  it('logs an error when purge reports failure without throwing', async () => {
    purgeSpy.mockResolvedValue({
      success: false,
      errors: [{ code: 1234, message: 'tag limit exceeded' }],
    });

    await purgeContentCache({ siteId: SITE_ID, branchId: BRANCH_ID });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg, , fields] = logger.error.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect(msg).toContain('rejected');
    expect(fields.site_id).toBe(SITE_ID);
    expect(fields.reason).toContain('tag limit exceeded');
  });

  it('logs an error when purge throws', async () => {
    purgeSpy.mockRejectedValue(new Error('network down'));

    await purgeContentCache({ siteId: SITE_ID, branchId: BRANCH_ID });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg] = logger.error.mock.calls[0] as [string];
    expect(msg).toContain('threw');
  });

  // A failed purge must not fail the publish that already committed.
  it('never throws', async () => {
    purgeSpy.mockRejectedValue(new Error('network down'));

    await expect(purgeContentCache({ siteId: SITE_ID })).resolves.toBeUndefined();
  });

  it('does not purge when there is nothing to name', async () => {
    await purgeContentCache({ siteId: '' });

    expect(purgeSpy).not.toHaveBeenCalled();
  });
});
