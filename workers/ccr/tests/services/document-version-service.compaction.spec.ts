/**
 * Version history compaction.
 *
 * Compaction converts the previous version to diff-only by nulling its
 * snapshot once the new version stores a forward patch. A row may only be
 * nulled when it carries a patch of its own, or its content becomes
 * unrecoverable. Reconstruction must fail rather than skip a row it cannot
 * rebuild.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

interface MockVersionRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown> | null;
  patch: unknown[] | null;
  source: string;
  created_by_id: string;
  created_by_type: string;
  created_at: string;
  is_tombstone?: boolean;
}

function versionRow(overrides: Partial<MockVersionRow> = {}): MockVersionRow {
  return {
    id: 'version-1',
    document_id: 'doc-1',
    branch_id: 'branch-1',
    version_number: 1,
    snapshot: { content: ['a'] },
    patch: null,
    source: 'edit',
    created_by_id: 'user-1',
    created_by_type: 'user',
    created_at: '2026-07-30T10:00:00.000Z',
    ...overrides,
  };
}

/** Params of the compacting statement, which is always the final query. */
function lastQueryParams(mockQuery: { mock: { calls: unknown[][] } }): unknown[] {
  const calls = mockQuery.mock.calls;
  return calls[calls.length - 1]?.[1] as unknown[];
}

describe('Version compaction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createDocumentVersion', () => {
    it('leaves the previous snapshot in place when that row carries no patch', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      // A create-path row: full snapshot, no patch, at a version above 1.
      const previous = versionRow({ id: 'version-2', version_number: 2, patch: null });
      const created = versionRow({
        id: 'version-3',
        version_number: 3,
        snapshot: { content: ['a', 'b'] },
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // $12 gates the nullify_previous CTE.
      expect(lastQueryParams(vi.mocked(db.query))[11]).toBe(false);
    });

    it('compacts the previous snapshot when that row carries a patch', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-3', version_number: 3 });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      const params = lastQueryParams(vi.mocked(db.query));
      expect(params[11]).toBe(true);
      expect(params[10]).toBe('version-2');
    });

    it('never compacts version 1', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const previous = versionRow({
        id: 'version-1',
        version_number: 1,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-2', version_number: 2 });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(lastQueryParams(vi.mocked(db.query))[11]).toBe(false);
    });

    it('compacts when only the duplicate check is skipped', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-3', version_number: 3 });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        skipDuplicateCheck: true,
      });

      expect(lastQueryParams(vi.mocked(db.query))[11]).toBe(true);
    });

    it('writes a standalone baseline when compaction is skipped', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const created = versionRow({ id: 'version-3', version_number: 3 });
      vi.mocked(db.query).mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'merge',
        createdById: 'user-1',
        createdByType: 'user',
        skipDuplicateCheck: true,
        skipCompaction: true,
      });

      // No previous version is read, and nothing is nulled.
      expect(vi.mocked(db.query).mock.calls).toHaveLength(1);
      expect(lastQueryParams(vi.mocked(db.query))[11]).toBe(false);
    });

    it('guards the nullify statement on the target row carrying a patch', async () => {
      const { createDocumentVersion } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-3', version_number: 3 });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // The SQL carries the invariant too, so a stale read cannot hollow a row.
      const calls = vi.mocked(db.query).mock.calls;
      const sql = calls[calls.length - 1]?.[0] ?? '';
      expect(sql).toMatch(/SET snapshot = NULL[\s\S]*patch IS NOT NULL/);
    });
  });

  describe('batchSyncToPostgres', () => {
    it('leaves the previous snapshot in place when that row carries no patch', async () => {
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const inserted = versionRow({
        id: 'version-3',
        version_number: 3,
        snapshot: { content: ['a', 'b'] },
      });
      const previous = versionRow({ id: 'version-2', version_number: 2, patch: null });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [inserted] })
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [] });

      await batchSyncToPostgres([
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          branchId: '22222222-2222-4222-8222-222222222222',
          snapshot: { content: ['a', 'b'] },
          actorId: '33333333-3333-4333-8333-333333333333',
          actorType: 'user',
        },
      ]);

      // $4 gates the nullify half of the compacting statement.
      expect(lastQueryParams(vi.mocked(db.query))[3]).toBe(false);
    });

    it('compacts the previous snapshot when that row carries a patch', async () => {
      const { batchSyncToPostgres } = await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const inserted = versionRow({
        id: 'version-3',
        version_number: 3,
        snapshot: { content: ['a', 'b'] },
      });
      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [inserted] })
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [] });

      await batchSyncToPostgres([
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          branchId: '22222222-2222-4222-8222-222222222222',
          snapshot: { content: ['a', 'b'] },
          actorId: '33333333-3333-4333-8333-333333333333',
          actorType: 'user',
        },
      ]);

      expect(lastQueryParams(vi.mocked(db.query))[3]).toBe(true);
    });
  });

  describe('reconstructVersionSnapshot', () => {
    it('throws when the chain reaches a row holding neither snapshot nor patch', async () => {
      const { reconstructVersionSnapshot } =
        await import('../../src/services/document-version-service');
      const { VersionReconstructionError } = await import('../../src/services/errors');
      const db = await import('../../src/db');

      const target = versionRow({ id: 'version-4', version_number: 4, snapshot: null, patch: null });
      const baseline = versionRow({ id: 'version-1', version_number: 1 });
      const hollow = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const diff = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [baseline] })
        .mockResolvedValueOnce({ rows: [diff, hollow, target] });

      await expect(
        reconstructVersionSnapshot('doc-1', 'branch-1', 4),
      ).rejects.toBeInstanceOf(VersionReconstructionError);
    });

    it('names the version it could not rebuild', async () => {
      const { reconstructVersionSnapshot } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const target = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const baseline = versionRow({ id: 'version-1', version_number: 1 });
      const hollow = versionRow({ id: 'version-2', version_number: 2, snapshot: null, patch: null });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [baseline] })
        .mockResolvedValueOnce({ rows: [hollow, target] });

      await expect(
        reconstructVersionSnapshot('doc-1', 'branch-1', 3),
      ).rejects.toThrow(/version 2/);
    });

    it('reconstructs when every row between baseline and target carries a patch', async () => {
      const { reconstructVersionSnapshot } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const target = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const diff2 = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });
      const diff3 = versionRow({
        id: 'version-3',
        version_number: 3,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/2', value: 'c' }],
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [baseline] })
        .mockResolvedValueOnce({ rows: [diff2, diff3] });

      const result = await reconstructVersionSnapshot('doc-1', 'branch-1', 3);

      expect(result).toEqual({ content: ['a', 'b', 'c'] });
    });
  });

  describe('re-baseline interval', () => {
    async function compactOver(previousVersionNumber: number): Promise<unknown[]> {
      const { createDocumentVersion } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const previous = versionRow({
        id: 'version-prev',
        version_number: previousVersionNumber,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({
        id: 'version-next',
        version_number: previousVersionNumber + 1,
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [created] });

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      return lastQueryParams(vi.mocked(db.query));
    }

    it('keeps the snapshot on every 25th version', async () => {
      expect((await compactOver(25))[11]).toBe(false);
      vi.resetAllMocks();
      expect((await compactOver(50))[11]).toBe(false);
      vi.resetAllMocks();
      expect((await compactOver(100))[11]).toBe(false);
    });

    it('still compacts versions either side of the interval', async () => {
      expect((await compactOver(24))[11]).toBe(true);
      vi.resetAllMocks();
      expect((await compactOver(26))[11]).toBe(true);
    });

    it('keeps the snapshot on every 25th version in the batch sync path', async () => {
      const { batchSyncToPostgres } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const inserted = versionRow({
        id: 'version-26',
        version_number: 26,
        snapshot: { content: ['a', 'b'] },
      });
      const previous = versionRow({
        id: 'version-25',
        version_number: 25,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [inserted] })
        .mockResolvedValueOnce({ rows: [previous] })
        .mockResolvedValueOnce({ rows: [] });

      await batchSyncToPostgres([
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          branchId: '22222222-2222-4222-8222-222222222222',
          snapshot: { content: ['a', 'b'] },
          actorId: '33333333-3333-4333-8333-333333333333',
          actorType: 'user',
        },
      ]);

      expect(lastQueryParams(vi.mocked(db.query))[3]).toBe(false);
    });
  });

  describe('replayVersionChain', () => {
    it('stops at a broken link and reports the content it reached', async () => {
      const { replayVersionChain } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const diff2 = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });
      const hollow = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const target = versionRow({ id: 'version-4', version_number: 4, snapshot: null, patch: null });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [baseline] })
        .mockResolvedValueOnce({ rows: [diff2, hollow, target] });

      const replay = await replayVersionChain('doc-1', 'branch-1', 4);

      // The content below the break falls out of the same pass — a caller
      // degrading to it needs no second reconstruction.
      expect(replay?.snapshot).toEqual({ content: ['a', 'b'] });
      expect(replay?.reachedVersion).toBe(2);
      expect(replay?.brokenVersion).toBe(3);
    });

    it('reports no break when the chain is intact', async () => {
      const { replayVersionChain } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const target = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [baseline] })
        .mockResolvedValueOnce({ rows: [target] });

      const replay = await replayVersionChain('doc-1', 'branch-1', 2);

      expect(replay?.snapshot).toEqual({ content: ['a', 'b'] });
      expect(replay?.reachedVersion).toBe(2);
      expect(replay?.brokenVersion).toBeUndefined();
    });

    it('replays the chain exactly once', async () => {
      const { replayVersionChain } =
        await import('../../src/services/document-version-service');
      const db = await import('../../src/db');

      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const hollow = versionRow({ id: 'version-2', version_number: 2, snapshot: null, patch: null });
      const target = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [baseline] })
        .mockResolvedValueOnce({ rows: [hollow, target] });

      await replayVersionChain('doc-1', 'branch-1', 3);

      // Target lookup, baseline lookup, diff range — and nothing more. A
      // degraded read used to pay this sequence twice.
      expect(vi.mocked(db.query).mock.calls).toHaveLength(3);
    });
  });
});
