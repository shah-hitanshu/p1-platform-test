/**
 * Branch resolution cache tests (PCC-3712)
 *
 * Branch metadata lookups ran against Postgres on every content request; in
 * the 2026-08-19 CloudSQL saturation incident they were 54% of summed DB
 * query time. These tests pin the per-isolate memoization that removes that
 * per-request round trip: a warm isolate must serve branch resolution with
 * zero app.branches queries, while mutations keep this isolate coherent by
 * evicting and always validate against the live row, never a cached one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { branches, sites } from '../../src/db/schema';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import {
  archiveBranch,
  clearBranchCache,
  createBranch,
  getBranch,
  getBranchByName,
  getMainBranch,
  updateBranch,
  updateBranchStatus,
} from '../../src/services/branch-service';
import { archiveSite } from '../../src/services/site-service';

function branchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'branch-uuid-123',
    siteId: 'site-uuid-456',
    name: 'main',
    description: null,
    status: 'active',
    isMain: true,
    sourceBranchId: null,
    sourceCheckpointId: null,
    createdById: 'user-uuid-789',
    createdByType: 'user',
    createdAt: new Date('2026-08-19T10:00:00.000Z'),
    updatedAt: new Date('2026-08-19T10:00:00.000Z'),
    archivedAt: null,
    ...overrides,
  };
}

describe('Branch resolution cache (PCC-3712)', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
    // Cache is per-isolate (module scope), so it must be emptied between tests.
    clearBranchCache();
  });

  describe('memoized lookups', () => {
    it('serves repeat id lookups from the cache without a second query', async () => {
      database.on(branches).select.returns([branchRow({ isMain: false, name: 'feature' })]);

      const first = await getBranch('branch-uuid-123');
      const second = await getBranch('branch-uuid-123');

      expect(first).toEqual(second);
      expect(first?.id).toBe('branch-uuid-123');
      expect(database.calls(branches).select).toHaveLength(1);
    });

    it('serves repeat (siteId, name) lookups from the cache', async () => {
      database.on(branches).select.returns([branchRow({ isMain: false, name: 'feature' })]);

      const first = await getBranchByName('site-uuid-456', 'feature');
      const second = await getBranchByName('site-uuid-456', 'feature');

      expect(first?.name).toBe('feature');
      expect(second?.name).toBe('feature');
      expect(database.calls(branches).select).toHaveLength(1);
    });

    it('serves repeat main-branch lookups from the cache — the default-path lookup every content request makes', async () => {
      database.on(branches).select.returns([branchRow()]);

      await getMainBranch('site-uuid-456');
      const second = await getMainBranch('site-uuid-456');

      expect(second?.isMain).toBe(true);
      expect(database.calls(branches).select).toHaveLength(1);
    });

    it('caches misses so junk ?branch= names cost one query per TTL, not one per request', async () => {
      expect(await getBranchByName('site-uuid-456', 'wp-login.php')).toBeNull();
      expect(await getBranchByName('site-uuid-456', 'wp-login.php')).toBeNull();

      expect(database.calls(branches).select).toHaveLength(1);
    });

    it('keeps key shapes independent — an id hit does not satisfy a name or main lookup', async () => {
      database.on(branches).select.returns([branchRow()]);

      await getBranch('branch-uuid-123');
      await getBranchByName('site-uuid-456', 'main');
      await getMainBranch('site-uuid-456');

      expect(database.calls(branches).select).toHaveLength(3);
    });

    it('collapses concurrent lookups of the same key into one query', async () => {
      database.on(branches).select.returns([branchRow()]);

      const results = await Promise.all([
        getMainBranch('site-uuid-456'),
        getMainBranch('site-uuid-456'),
        getMainBranch('site-uuid-456'),
      ]);

      expect(results.every((r) => r?.id === 'branch-uuid-123')).toBe(true);
      expect(database.calls(branches).select).toHaveLength(1);
    });

    it('expires entries after the TTL so cross-isolate mutations converge', async () => {
      vi.useFakeTimers();
      try {
        database.on(branches).select.returns([branchRow()]);

        await getMainBranch('site-uuid-456');
        vi.advanceTimersByTime(31_000);
        await getMainBranch('site-uuid-456');

        expect(database.calls(branches).select).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not cache a failed lookup — a transient DB error must not become a TTL-long outage', async () => {
      database.on(branches).select.rejects(new Error('connection reset'));

      await expect(getMainBranch('site-uuid-456')).rejects.toThrow();

      // A second handle answering normally stands in for the database coming back.
      const recovered = stubDatabase();
      recovered.on(branches).select.returns([branchRow()]);

      expect((await getMainBranch('site-uuid-456'))?.id).toBe('branch-uuid-123');
      expect(recovered.calls(branches).select).toHaveLength(1);
    });
  });

  describe('mutation eviction', () => {
    it('updateBranch evicts so this isolate never serves a renamed branch under its old name', async () => {
      database.on(branches).select.returns([branchRow({ isMain: false, name: 'draft' })]);
      database.on(branches).update.returns([branchRow({ isMain: false, name: 'launch' })]);

      await getBranchByName('site-uuid-456', 'draft');
      await updateBranch('branch-uuid-123', { name: 'launch' });

      // Nothing answers the old name any more.
      database.on(branches).select.returns([]);
      const afterRename = await getBranchByName('site-uuid-456', 'draft');

      expect(afterRename).toBeNull();
      expect(database.calls(branches).select).toHaveLength(2);
    });

    it('archiveBranch reads the live row and evicts, so the archived branch stops resolving here', async () => {
      database.on(branches).select.returns([branchRow({ isMain: false, name: 'feature' })]);
      database.on(branches).update.returns([{ id: 'branch-uuid-123' }]);

      await getBranch('branch-uuid-123'); // warm
      const result = await archiveBranch('branch-uuid-123');
      await getBranch('branch-uuid-123');

      expect(result).toBe(true);
      // Three reads: the warm one, archiveBranch's own uncached read (it must
      // not act on a cached row), and the post-eviction re-read.
      expect(database.calls(branches).select).toHaveLength(3);
    });

    it('updateBranchStatus validates the transition against the live row, not a stale cached one', async () => {
      // Cache says 'active' (from which → merged is an invalid transition);
      // the DB row has since moved to 'review' (from which it is valid). Only
      // an uncached read lets the merge proceed.
      database.on(branches).select.returns([
        branchRow({ isMain: false, name: 'feature', status: 'active' }),
      ]);
      await getBranch('branch-uuid-123');

      database.on(branches).select.returns([
        branchRow({ isMain: false, name: 'feature', status: 'review' }),
      ]);
      database.on(branches).update.returns([
        branchRow({ isMain: false, name: 'feature', status: 'merged' }),
      ]);

      const result = await updateBranchStatus('branch-uuid-123', 'merged');

      expect(result?.status).toBe('merged');
      expect(database.calls(branches).select).toHaveLength(2);
    });

    it('createBranch evicts cached negative name lookups so a new branch resolves immediately in this isolate', async () => {
      expect(await getBranchByName('site-uuid-456', 'feature')).toBeNull(); // negative cached

      const newRow = branchRow({
        id: 'branch-uuid-new',
        isMain: false,
        name: 'feature',
        sourceBranchId: 'branch-uuid-main',
      });
      database.on(branches).select.returns([{ id: 'branch-uuid-main', isMain: true }]);
      database.on(branches).insert.returns([newRow]);

      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature',
        sourceBranchId: 'branch-uuid-main',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });

      database.on(branches).select.returns([newRow]);
      const afterCreate = await getBranchByName('site-uuid-456', 'feature');

      expect(afterCreate?.id).toBe('branch-uuid-new');
    });

    it('archiveSite evicts so an archived site’s branches stop resolving in this isolate', async () => {
      database.on(branches).select.returns([branchRow()]);
      database.on(sites).update.returns([{ archivedAt: new Date('2026-08-19T12:00:00.000Z') }]);

      expect(await getMainBranch('site-uuid-456')).not.toBeNull(); // warm
      await archiveSite('site-uuid-456');

      database.on(branches).select.returns([]);
      // Without eviction the cached main branch would keep serving for the TTL.
      expect(await getMainBranch('site-uuid-456')).toBeNull();
    });
  });
});
