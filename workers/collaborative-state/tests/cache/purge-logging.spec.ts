/**
 * Purge observability.
 *
 * cache.purge() reports failure in its result rather than rejecting, so these
 * log lines are the only evidence a purge did not happen — and a purge that
 * did not happen means indefinitely stale published content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cache } from 'cloudflare:workers';
import { purgeContentCache, purgeDeletedDocument } from '../../src/cache/purge';

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

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.site_id).toBe(SITE_ID);
    expect(fields.branch_id).toBe(BRANCH_ID);
    expect(fields.outcome).toBe('success');
    expect(fields.count).toBe(1);
    expect(fields.cache_tags).toBe(`site:${SITE_ID}`);
  });

  // Production runs LOG_LEVEL=warn; info-level success made purges
  // forensically invisible during the 2026-08-19 incident investigation, so
  // success must log at warn or the visibility regresses [PCC-3709].
  it('logs success at a level visible in production, not info', async () => {
    await purgeContentCache({ siteId: SITE_ID });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  // Site-wide by design: cached 404s carry no doc tag, so for reveal-class
  // events (publish, merge, restore) a narrower purge would leave a freshly
  // revealed path 404ing for its full TTL. branchId and documentId are log
  // context, not purge scope. Delete-class events use purgeDeletedDocument.
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

// Deletion creates 404s, it does not reveal any, so the delete-class purge
// can be narrow. This is what stops one delete from evicting the whole
// site's edge cache [PCC-3709].
describe('purgeDeletedDocument', () => {
  it('purges exactly the document and the listings — never the site tag', async () => {
    await purgeDeletedDocument({
      siteId: SITE_ID,
      branchId: BRANCH_ID,
      documentId: 'doc-1',
    });

    expect(purgeSpy).toHaveBeenCalledWith({
      tags: ['doc:doc-1', `list:${SITE_ID}`],
    });
  });

  it('logs success at a production-visible level with the tag list', async () => {
    await purgeDeletedDocument({ siteId: SITE_ID, documentId: 'doc-1' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields.outcome).toBe('success');
    expect(fields.count).toBe(2);
    expect(fields.cache_tags).toBe(`doc:doc-1,list:${SITE_ID}`);
    expect(fields.document_id).toBe('doc-1');
  });

  // These tests mock the logger, which bypasses p1-telemetry's redaction
  // allowlist — the first staging deploy logged `tags` and production dropped
  // the field silently (`"_dropped": ["tags"]`). Pin every field the purge
  // logs to the real allowlist so a rename can't reopen that gap.
  it('logs only fields that survive the production redaction allowlist', async () => {
    const { ALLOWED_FIELDS } = await import('@pantheon-systems/p1-telemetry');

    // Success (warn) path for both purge shapes...
    await purgeContentCache({ siteId: SITE_ID, branchId: BRANCH_ID, documentId: 'doc-1' });
    await purgeDeletedDocument({ siteId: SITE_ID, branchId: BRANCH_ID, documentId: 'doc-1' });
    // ...and both error paths (fields ride the logger's THIRD argument there).
    purgeSpy.mockResolvedValueOnce({
      success: false,
      errors: [{ code: 1234, message: 'rejected' }],
    });
    await purgeContentCache({ siteId: SITE_ID });
    purgeSpy.mockRejectedValueOnce(new Error('network down'));
    await purgeDeletedDocument({ siteId: SITE_ID, documentId: 'doc-1' });

    const allowed = new Set<string>(ALLOWED_FIELDS);
    const fieldSets = [
      ...logger.warn.mock.calls.map((c) => c[1] as Record<string, unknown>),
      ...logger.error.mock.calls.map((c) => c[2] as Record<string, unknown>),
    ];
    expect(logger.warn.mock.calls.length).toBeGreaterThan(0);
    expect(logger.error.mock.calls.length).toBeGreaterThan(0);
    for (const fields of fieldSets) {
      for (const key of Object.keys(fields)) {
        expect(
          allowed.has(key),
          `purge log field "${key}" would be dropped in production`,
        ).toBe(true);
      }
    }
  });

  it('logs an error when purge reports failure without throwing', async () => {
    purgeSpy.mockResolvedValue({
      success: false,
      errors: [{ code: 1234, message: 'tag limit exceeded' }],
    });

    await purgeDeletedDocument({ siteId: SITE_ID, documentId: 'doc-1' });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  // A failed purge must not fail the delete that already committed.
  it('never throws', async () => {
    purgeSpy.mockRejectedValue(new Error('network down'));

    await expect(
      purgeDeletedDocument({ siteId: SITE_ID, documentId: 'doc-1' }),
    ).resolves.toBeUndefined();
  });

  // Without both ids the tags would go to the edge malformed ("doc:"/"list:").
  it('does not purge when the site or document is unnamed', async () => {
    await purgeDeletedDocument({ siteId: '', documentId: 'doc-1' });
    await purgeDeletedDocument({ siteId: SITE_ID, documentId: '' });

    expect(purgeSpy).not.toHaveBeenCalled();
  });
});
