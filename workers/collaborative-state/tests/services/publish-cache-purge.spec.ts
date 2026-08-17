/**
 * Publish-time cache invalidation.
 *
 * Workers Caching keys on the URL and publishing does not change the URL, so a
 * new version stays invisible at the edge until its tag is purged. The content
 * API serves versions captured by checkpoint_type = 'publish', which only
 * publishDocument and publishMergedVersions create — both onto the main
 * branch, whatever branch the content came from.
 *
 * Site import also writes a publish checkpoint in raw SQL, and purges the site
 * tag once at the end of the import rather than per checkpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SITE_ID = 'site-123';
const MAIN_BRANCH_ID = 'branch-main';
const SOURCE_BRANCH_ID = 'branch-feature';
const DOCUMENT_ID = 'doc-456';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getMainBranch: vi.fn(),
  getBranch: vi.fn(),
  createCheckpoint: vi.fn(),
  purgeContentCache: vi.fn(),
  events: [] as string[],
}));

vi.mock('../../src/db', () => ({
  query: mocks.query,
  runWithConnection: vi.fn().mockImplementation(
    (_conn: string, _opts: unknown, fn: () => unknown) => fn(),
  ),
}));

vi.mock('../../src/services/branch-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/branch-service')>();
  return { ...actual, getMainBranch: mocks.getMainBranch, getBranch: mocks.getBranch };
});

vi.mock('../../src/services/checkpoint-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/checkpoint-service')>();
  return { ...actual, createCheckpoint: mocks.createCheckpoint };
});

vi.mock('../../src/cache/purge', () => ({
  purgeContentCache: mocks.purgeContentCache,
}));

const checkpointRow = {
  id: 'cp-1',
  branch_id: MAIN_BRANCH_ID,
  name: 'Publish: document',
  checkpoint_type: 'publish',
  created_by_id: 'user-alice',
  created_by_type: 'user',
  status: 'completed',
  created_at: '2026-08-14T00:00:00.000Z',
};

function stubQuery(sql: string) {
  if (sql.includes('COMMIT')) {
    mocks.events.push('commit');
    return { rows: [] };
  }
  if (sql.includes('BEGIN') || sql.includes('ROLLBACK')) return { rows: [] };
  if (sql.includes('FROM app.document_versions') && sql.includes('is_tombstone')) {
    return {
      rows: [{
        id: 'ver-source-1',
        document_id: DOCUMENT_ID,
        branch_id: SOURCE_BRANCH_ID,
        version_number: 1,
        snapshot: {},
        is_tombstone: false,
      }],
    };
  }
  if (sql.includes('INSERT INTO app.document_versions')) {
    return { rows: [{ id: 'ver-main-1', version_number: 2 }] };
  }
  if (sql.includes('INSERT INTO app.checkpoints')) {
    return { rows: [checkpointRow] };
  }
  return { rows: [] };
}

function publishParams(branchId: string) {
  return {
    siteId: SITE_ID,
    branchId,
    documentId: DOCUMENT_ID,
    createdById: 'user-alice',
    createdByType: 'user' as const,
  };
}

describe('publish invalidates the edge cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.query.mockImplementation((sql: string) => Promise.resolve(stubQuery(sql)));
    mocks.getMainBranch.mockResolvedValue({ id: MAIN_BRANCH_ID, name: 'main', isMain: true });
    mocks.getBranch.mockResolvedValue({ id: SOURCE_BRANCH_ID, name: 'feature', isMain: false });
    mocks.purgeContentCache.mockImplementation(() => {
      mocks.events.push('purge');
      return Promise.resolve();
    });
  });

  describe('publishDocument', () => {
    it('purges the published document on the main branch', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-publish');

      await publishDocument(publishParams(MAIN_BRANCH_ID));

      expect(mocks.purgeContentCache).toHaveBeenCalledTimes(1);
      const params = mocks.purgeContentCache.mock.calls[0]?.[0] as { documentId?: string };
      expect(params.documentId).toBe(DOCUMENT_ID);
    });

    // Publishing from a feature branch makes content live on main. Purging the
    // source branch's tag would leave the published page stale.
    it('purges the main branch tag, not the source branch it published from', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-publish');

      await publishDocument(publishParams(SOURCE_BRANCH_ID));

      const params = mocks.purgeContentCache.mock.calls[0]?.[0] as { branchId?: string };
      expect(params.branchId).toBe(MAIN_BRANCH_ID);
      expect(params.branchId).not.toBe(SOURCE_BRANCH_ID);
    });

    // Purging before COMMIT lets a concurrent read re-cache the pre-publish
    // version, which then survives for a full TTL.
    it('purges after the transaction commits', async () => {
      const { publishDocument } = await import('../../src/services/checkpoint-publish');

      await publishDocument(publishParams(MAIN_BRANCH_ID));

      expect(mocks.events).toEqual(['commit', 'purge']);
    });

    it('does not purge when the publish fails', async () => {
      mocks.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM app.document_versions') && sql.includes('is_tombstone')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve(stubQuery(sql));
      });
      const { publishDocument } = await import('../../src/services/checkpoint-publish');

      await publishDocument(publishParams(MAIN_BRANCH_ID)).catch(() => undefined);

      expect(mocks.purgeContentCache).not.toHaveBeenCalled();
    });
  });

  describe('publishMergedVersions', () => {
    const mergedVersions = [
      { documentId: DOCUMENT_ID, documentVersionId: 'ver-main-1', sourceVersionId: 'ver-source-1' },
    ];

    function mergeParams() {
      return {
        siteId: SITE_ID,
        mainBranchId: MAIN_BRANCH_ID,
        sourceBranchId: SOURCE_BRANCH_ID,
        mergedVersions,
        mergedById: 'user-alice',
        mergedByType: 'user' as const,
        mergeTitle: 'Feature work',
      };
    }

    beforeEach(() => {
      mocks.createCheckpoint.mockResolvedValue({
        checkpoint: { id: 'cp-2', branchId: MAIN_BRANCH_ID },
      });
    });

    it('purges the main branch after an auto-publish merge', async () => {
      const { publishMergedVersions } = await import('../../src/services/merge-publish');

      await publishMergedVersions(mergeParams());

      expect(mocks.purgeContentCache).toHaveBeenCalledTimes(1);
      const params = mocks.purgeContentCache.mock.calls[0]?.[0] as { branchId?: string };
      expect(params.branchId).toBe(MAIN_BRANCH_ID);
    });

    // The checkpoint has already committed by the time the provenance UPDATEs
    // run, so a throw there used to skip the purge entirely and leave the edge
    // serving pre-merge content for a full TTL with no log signal.
    it('still purges when the best-effort provenance updates throw', async () => {
      mocks.query.mockImplementation((sql: string) => {
        if (sql.includes('SET source_branch_id')) {
          return Promise.reject(new Error('transient db error'));
        }
        return Promise.resolve(stubQuery(sql));
      });
      const { publishMergedVersions } = await import('../../src/services/merge-publish');

      await expect(publishMergedVersions(mergeParams())).rejects.toThrow('transient db error');

      expect(mocks.purgeContentCache).toHaveBeenCalledTimes(1);
      const params = mocks.purgeContentCache.mock.calls[0]?.[0] as { branchId?: string };
      expect(params.branchId).toBe(MAIN_BRANCH_ID);
    });

    it('does not purge when the merge published nothing', async () => {
      const { publishMergedVersions } = await import('../../src/services/merge-publish');

      await publishMergedVersions({ ...mergeParams(), mergedVersions: [] });

      expect(mocks.purgeContentCache).not.toHaveBeenCalled();
    });
  });
});
