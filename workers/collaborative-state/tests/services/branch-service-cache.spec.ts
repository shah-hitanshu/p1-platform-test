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

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

interface MockBranchRow {
  id: string;
  site_id: string;
  name: string;
  description: string | null;
  status: string;
  is_main: boolean;
  source_branch_id: string | null;
  source_checkpoint_id: string | null;
  created_by_id: string;
  created_by_type: 'user' | 'agent';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function createMockBranchRow(overrides: Partial<MockBranchRow> = {}): MockBranchRow {
  return {
    id: 'branch-uuid-123',
    site_id: 'site-uuid-456',
    name: 'main',
    description: null,
    status: 'active',
    is_main: true,
    source_branch_id: null,
    source_checkpoint_id: null,
    created_by_id: 'user-uuid-789',
    created_by_type: 'user',
    created_at: '2026-08-19T10:00:00.000Z',
    updated_at: '2026-08-19T10:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}

describe('Branch resolution cache (PCC-3712)', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // Cache is per-isolate (module scope), so it must be emptied between tests.
    const { clearBranchCache } = await import('../../src/services/branch-service');
    clearBranchCache();
  });

  describe('memoized lookups', () => {
    it('serves repeat id lookups from the cache without a second query', async () => {
      const { getBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockBranchRow({ is_main: false, name: 'feature' })] });

      const first = await getBranch('branch-uuid-123');
      const second = await getBranch('branch-uuid-123');

      expect(first).toEqual(second);
      expect(first?.id).toBe('branch-uuid-123');
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('serves repeat (siteId, name) lookups from the cache', async () => {
      const { getBranchByName } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockBranchRow({ is_main: false, name: 'feature' })] });

      const first = await getBranchByName('site-uuid-456', 'feature');
      const second = await getBranchByName('site-uuid-456', 'feature');

      expect(first?.name).toBe('feature');
      expect(second?.name).toBe('feature');
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('serves repeat main-branch lookups from the cache — the default-path lookup every content request makes', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockBranchRow()] });

      await getMainBranch('site-uuid-456');
      const second = await getMainBranch('site-uuid-456');

      expect(second?.isMain).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('caches misses so junk ?branch= names cost one query per TTL, not one per request', async () => {
      const { getBranchByName } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [] });

      expect(await getBranchByName('site-uuid-456', 'wp-login.php')).toBeNull();
      expect(await getBranchByName('site-uuid-456', 'wp-login.php')).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('keeps key shapes independent — an id hit does not satisfy a name or main lookup', async () => {
      const { getBranch, getBranchByName, getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query).mockResolvedValue({ rows: [createMockBranchRow()] });

      await getBranch('branch-uuid-123');
      await getBranchByName('site-uuid-456', 'main');
      await getMainBranch('site-uuid-456');

      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('collapses concurrent lookups of the same key into one query', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      let resolveQuery: (value: { rows: unknown[] }) => void = () => {};
      vi.mocked(db.query).mockReturnValue(
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
      );

      const inFlight = Promise.all([
        getMainBranch('site-uuid-456'),
        getMainBranch('site-uuid-456'),
        getMainBranch('site-uuid-456'),
      ]);
      await vi.waitFor(() => {
        expect(db.query).toHaveBeenCalled();
      });
      resolveQuery({ rows: [createMockBranchRow()] });

      const results = await inFlight;
      expect(results.every((r) => r?.id === 'branch-uuid-123')).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('expires entries after the TTL so cross-isolate mutations converge', async () => {
      vi.useFakeTimers();
      try {
        const { getMainBranch } = await import('../../src/services/branch-service');
        const db = await import('../../src/db');

        vi.mocked(db.query).mockResolvedValue({ rows: [createMockBranchRow()] });

        await getMainBranch('site-uuid-456');
        vi.advanceTimersByTime(31_000);
        await getMainBranch('site-uuid-456');

        expect(db.query).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not cache a failed lookup — a transient DB error must not become a TTL-long outage', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      vi.mocked(db.query)
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce({ rows: [createMockBranchRow()] });

      await expect(getMainBranch('site-uuid-456')).rejects.toThrow('connection reset');
      const retry = await getMainBranch('site-uuid-456');

      expect(retry?.id).toBe('branch-uuid-123');
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('mutation eviction', () => {
    it('updateBranch evicts so this isolate never serves a renamed branch under its old name', async () => {
      const { getBranchByName, updateBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const oldRow = createMockBranchRow({ is_main: false, name: 'draft' });
      const renamedRow = createMockBranchRow({ is_main: false, name: 'launch' });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [oldRow] }) // warm the name cache
        .mockResolvedValueOnce({ rows: [renamedRow] }) // UPDATE ... RETURNING
        .mockResolvedValueOnce({ rows: [] }); // re-read of old name after rename

      await getBranchByName('site-uuid-456', 'draft');
      await updateBranch('branch-uuid-123', { name: 'launch' });
      const afterRename = await getBranchByName('site-uuid-456', 'draft');

      expect(afterRename).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('archiveBranch reads the live row and evicts, so the archived branch stops resolving here', async () => {
      const { getBranch, archiveBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const row = createMockBranchRow({ is_main: false, name: 'feature' });
      let selectCalls = 0;
      vi.mocked(db.query).mockImplementation((sql: string) => {
        if (sql.startsWith('SELECT * FROM app.branches WHERE id')) {
          selectCalls++;
          return Promise.resolve({ rows: [row] });
        }
        if (sql.includes('SET archived_at = NOW()')) {
          return Promise.resolve({ rows: [{ id: row.id }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 }); // BEGIN / COMMIT
      });

      await getBranch('branch-uuid-123'); // warm (1st SELECT)
      const result = await archiveBranch('branch-uuid-123');
      await getBranch('branch-uuid-123');

      expect(result).toBe(true);
      // 3 SELECTs: the warm read, archiveBranch's own uncached read (it must
      // not act on a cached row), and the post-eviction re-read.
      expect(selectCalls).toBe(3);
    });

    it('updateBranchStatus validates the transition against the live row, not a stale cached one', async () => {
      const { getBranch, updateBranchStatus } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      // Cache says 'active' (from which → merged is an invalid transition);
      // the DB row has since moved to 'review' (from which it is valid). Only
      // an uncached read lets the merge proceed.
      const staleActive = createMockBranchRow({ is_main: false, name: 'feature', status: 'active' });
      const liveReview = createMockBranchRow({ is_main: false, name: 'feature', status: 'review' });
      const merged = createMockBranchRow({ is_main: false, name: 'feature', status: 'merged' });
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [staleActive] }) // warm the id cache
        .mockResolvedValueOnce({ rows: [liveReview] }) // uncached read inside updateBranchStatus
        .mockResolvedValueOnce({ rows: [merged] }); // UPDATE ... RETURNING

      await getBranch('branch-uuid-123');
      const result = await updateBranchStatus('branch-uuid-123', 'merged');

      expect(result?.status).toBe('merged');
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    it('createBranch evicts cached negative name lookups so a new branch resolves immediately in this isolate', async () => {
      const { getBranchByName, createBranch } = await import('../../src/services/branch-service');
      const db = await import('../../src/db');

      const newRow = createMockBranchRow({
        id: 'branch-uuid-new',
        is_main: false,
        name: 'feature',
        source_branch_id: 'branch-uuid-main',
      });
      let branchExists = false;
      vi.mocked(db.query).mockImplementation((sql: string) => {
        if (sql.includes('WHERE site_id = $1 AND name = $2')) {
          return Promise.resolve({ rows: branchExists ? [newRow] : [] });
        }
        if (sql.startsWith('SELECT id, is_main FROM app.branches')) {
          return Promise.resolve({ rows: [{ id: 'branch-uuid-main', is_main: true }] });
        }
        if (sql.includes('INSERT INTO app.branches')) {
          branchExists = true;
          return Promise.resolve({ rows: [newRow] });
        }
        if (sql.includes('SELECT id FROM app.checkpoints')) {
          return Promise.resolve({ rows: [] });
        }
        // BEGIN / COMMIT / structure-state copy
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      expect(await getBranchByName('site-uuid-456', 'feature')).toBeNull(); // negative cached
      await createBranch({
        siteId: 'site-uuid-456',
        name: 'feature',
        sourceBranchId: 'branch-uuid-main',
        createdById: 'user-uuid-789',
        createdByType: 'user',
      });
      const afterCreate = await getBranchByName('site-uuid-456', 'feature');

      expect(afterCreate?.id).toBe('branch-uuid-new');
    });

    it('archiveSite evicts so an archived site’s branches stop resolving in this isolate', async () => {
      const { getMainBranch } = await import('../../src/services/branch-service');
      const { archiveSite } = await import('../../src/services/site-service');
      const db = await import('../../src/db');

      let siteArchived = false;
      vi.mocked(db.query).mockImplementation((sql: string) => {
        if (sql.includes('is_main = TRUE')) {
          return Promise.resolve({ rows: siteArchived ? [] : [createMockBranchRow()] });
        }
        if (sql.includes('UPDATE app.sites SET archived_at')) {
          siteArchived = true;
          return Promise.resolve({ rows: [{ archived_at: '2026-08-19T12:00:00.000Z' }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 }); // BEGIN/COMMIT/branch+doc cascades
      });

      expect(await getMainBranch('site-uuid-456')).not.toBeNull(); // warm
      await archiveSite('site-uuid-456');
      // Without eviction the cached main branch would keep serving for the TTL.
      expect(await getMainBranch('site-uuid-456')).toBeNull();
    });
  });
});
