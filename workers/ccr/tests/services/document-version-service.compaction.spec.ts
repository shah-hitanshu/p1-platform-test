/**
 * Version history compaction.
 *
 * Compaction converts the previous version to diff-only by nulling its
 * snapshot once the new version stores a forward patch. A row may only be
 * nulled when it carries a patch of its own, or its content becomes
 * unrecoverable. Reconstruction must fail rather than skip a row it cannot
 * rebuild.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';
import {
  batchSyncToPostgres,
  createDocumentVersion,
  reconstructVersionSnapshot,
  replayVersionChain,
} from '../../src/services/document-version-service';
import { VersionReconstructionError } from '../../src/services/errors';


type MockVersionRow = {
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
};

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

/**
 * batchSyncToPostgres's own prev-version lookup reads through the Drizzle
 * query builder (camelCase columns), unlike its raw INSERT/UPDATE statements.
 */
function drizzlePrevRow(row: MockVersionRow): Record<string, unknown> {
  return {
    id: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    patch: row.patch,
    source: row.source,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    isTombstone: row.is_tombstone ?? false,
  };
}

/**
 * The compacting CTE's two inputs: the version it would null, and whether it is
 * allowed to. Read off the statement by their casts rather than by position.
 */
function compaction(database: DatabaseStub): { target: unknown; enabled: unknown } {
  const [insert] = database.calls(documentVersions).insert;
  const target = /id = \$(\d+)::uuid/.exec(insert.sql) ?? [];
  const enabled = /\$(\d+)::boolean/.exec(insert.sql) ?? [];
  return {
    target: insert.params[Number(target[1]) - 1],
    enabled: insert.params[Number(enabled[1]) - 1],
  };
}

describe('Version compaction', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  describe('createDocumentVersion', () => {
    it('leaves the previous snapshot in place when that row carries no patch', async () => {
      // A create-path row: full snapshot, no patch, at a version above 1.
      const previous = versionRow({ id: 'version-2', version_number: 2, patch: null });
      const created = versionRow({
        id: 'version-3',
        version_number: 3,
        snapshot: { content: ['a', 'b'] },
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });

      database.on(documentVersions).select.returnsRaw([previous]);
      database.on(documentVersions).insert.returnsRaw([created]);

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(compaction(database).enabled).toBe(false);
    });

    it('compacts the previous snapshot when that row carries a patch', async () => {
      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-3', version_number: 3 });

      database.on(documentVersions).select.returnsRaw([previous]);
      database.on(documentVersions).insert.returnsRaw([created]);

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(compaction(database)).toMatchObject({ enabled: true, target: 'version-2' });
    });

    it('never compacts version 1', async () => {
      const previous = versionRow({
        id: 'version-1',
        version_number: 1,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-2', version_number: 2 });

      database.on(documentVersions).select.returnsRaw([previous]);
      database.on(documentVersions).insert.returnsRaw([created]);

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      expect(compaction(database).enabled).toBe(false);
    });

    it('compacts when only the duplicate check is skipped', async () => {
      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-3', version_number: 3 });

      database.on(documentVersions).select.returnsRaw([previous]);
      database.on(documentVersions).insert.returnsRaw([created]);

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        skipDuplicateCheck: true,
      });

      expect(compaction(database).enabled).toBe(true);
    });

    it('writes a standalone baseline when compaction is skipped', async () => {
      const created = versionRow({ id: 'version-3', version_number: 3 });
      database.on(documentVersions).insert.returnsRaw([created]);

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
      expect(database.statements).toHaveLength(1);
      expect(compaction(database).enabled).toBe(false);
    });

    it('guards the nullify statement on the target row carrying a patch', async () => {
      const previous = versionRow({
        id: 'version-2',
        version_number: 2,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({ id: 'version-3', version_number: 3 });

      database.on(documentVersions).select.returnsRaw([previous]);
      database.on(documentVersions).insert.returnsRaw([created]);

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      // The SQL carries the invariant too, so a stale read cannot hollow a row.
      expect(database.calls(documentVersions).insert[0].sql).toMatch(
        /SET snapshot = NULL[\s\S]*patch IS NOT NULL/,
      );
    });
  });

  describe('batchSyncToPostgres', () => {
    it('leaves the previous snapshot in place when that row carries no patch', async () => {

      const inserted = versionRow({
        id: 'version-3',
        version_number: 3,
        snapshot: { content: ['a', 'b'] },
      });
      const previous = versionRow({ id: 'version-2', version_number: 2, patch: null });

      database.on(documentVersions).insert.returnsRaw([inserted]);
      database.on(documentVersions).select.returnsRaw([drizzlePrevRow(previous)]);

      await batchSyncToPostgres([
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          branchId: '22222222-2222-4222-8222-222222222222',
          snapshot: { content: ['a', 'b'] },
          actorId: '33333333-3333-4333-8333-333333333333',
          actorType: 'user',
        },
      ]);

      // The 4th bind gates the nullify half of the compacting statement.
      expect(database.calls(documentVersions).update[0].params[3]).toBe(false);
    });

    it('compacts the previous snapshot when that row carries a patch', async () => {

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

      database.on(documentVersions).insert.returnsRaw([inserted]);
      database.on(documentVersions).select.returnsRaw([drizzlePrevRow(previous)]);

      await batchSyncToPostgres([
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          branchId: '22222222-2222-4222-8222-222222222222',
          snapshot: { content: ['a', 'b'] },
          actorId: '33333333-3333-4333-8333-333333333333',
          actorType: 'user',
        },
      ]);

      expect(database.calls(documentVersions).update[0].params[3]).toBe(true);
    });
  });

  describe('reconstructVersionSnapshot', () => {
    it('throws when the chain reaches a row holding neither snapshot nor patch', async () => {
      const target = versionRow({ id: 'version-4', version_number: 4, snapshot: null, patch: null });
      const baseline = versionRow({ id: 'version-1', version_number: 1 });
      const hollow = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const diff = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });

      database.on(documentVersions).select.whenAsking(/snapshot IS NOT NULL/).returnsRaw([baseline]);
      database.on(documentVersions).select.whenAsking(/version_number >/).returnsRaw([diff, hollow, target]);
      database.on(documentVersions).select.returnsRaw([target]);

      await expect(
        reconstructVersionSnapshot('doc-1', 'branch-1', 4),
      ).rejects.toBeInstanceOf(VersionReconstructionError);
    });

    it('names the version it could not rebuild', async () => {
      const target = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const baseline = versionRow({ id: 'version-1', version_number: 1 });
      const hollow = versionRow({ id: 'version-2', version_number: 2, snapshot: null, patch: null });

      database.on(documentVersions).select.whenAsking(/snapshot IS NOT NULL/).returnsRaw([baseline]);
      database.on(documentVersions).select.whenAsking(/version_number >/).returnsRaw([hollow, target]);
      database.on(documentVersions).select.returnsRaw([target]);

      await expect(
        reconstructVersionSnapshot('doc-1', 'branch-1', 3),
      ).rejects.toThrow(/version 2/);
    });

    it('reconstructs when every row between baseline and target carries a patch', async () => {
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

      database.on(documentVersions).select.whenAsking(/snapshot IS NOT NULL/).returnsRaw([baseline]);
      database.on(documentVersions).select.whenAsking(/version_number >/).returnsRaw([diff2, diff3]);
      database.on(documentVersions).select.returnsRaw([target]);

      const result = await reconstructVersionSnapshot('doc-1', 'branch-1', 3);

      expect(result).toEqual({ content: ['a', 'b', 'c'] });
    });
  });

  describe('re-baseline interval', () => {
    async function compactOver(previousVersionNumber: number): Promise<unknown> {
      const previous = versionRow({
        id: 'version-prev',
        version_number: previousVersionNumber,
        patch: [{ op: 'add', path: '/content/0', value: 'a' }],
      });
      const created = versionRow({
        id: 'version-next',
        version_number: previousVersionNumber + 1,
      });

      database.on(documentVersions).select.returnsRaw([previous]);
      database.on(documentVersions).insert.returnsRaw([created]);

      await createDocumentVersion({
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: ['a', 'b'] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
      });

      return compaction(database).enabled;
    }

    it('keeps the snapshot on every 25th version', async () => {
      expect(await compactOver(25)).toBe(false);
      database = stubDatabase();
      expect(await compactOver(50)).toBe(false);
      database = stubDatabase();
      expect(await compactOver(100)).toBe(false);
    });

    it('still compacts versions either side of the interval', async () => {
      expect(await compactOver(24)).toBe(true);
      database = stubDatabase();
      expect(await compactOver(26)).toBe(true);
    });

    it('keeps the snapshot on every 25th version in the batch sync path', async () => {

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

      database.on(documentVersions).insert.returnsRaw([inserted]);
      database.on(documentVersions).select.returnsRaw([drizzlePrevRow(previous)]);

      await batchSyncToPostgres([
        {
          documentId: '11111111-1111-4111-8111-111111111111',
          branchId: '22222222-2222-4222-8222-222222222222',
          snapshot: { content: ['a', 'b'] },
          actorId: '33333333-3333-4333-8333-333333333333',
          actorType: 'user',
        },
      ]);

      expect(database.calls(documentVersions).update[0].params[3]).toBe(false);
    });
  });

  describe('replayVersionChain', () => {
    it('stops at a broken link and reports the content it reached', async () => {
      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const diff2 = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });
      const hollow = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });
      const target = versionRow({ id: 'version-4', version_number: 4, snapshot: null, patch: null });

      database.on(documentVersions).select.whenAsking(/snapshot IS NOT NULL/).returnsRaw([baseline]);
      database.on(documentVersions).select
        .whenAsking(/version_number >/)
        .returnsRaw([diff2, hollow, target]);
      database.on(documentVersions).select.returnsRaw([target]);

      const replay = await replayVersionChain('doc-1', 'branch-1', 4);

      // The content below the break falls out of the same pass — a caller
      // degrading to it needs no second reconstruction.
      expect(replay?.snapshot).toEqual({ content: ['a', 'b'] });
      expect(replay?.reachedVersion).toBe(2);
      expect(replay?.brokenVersion).toBe(3);
    });

    it('reports no break when the chain is intact', async () => {
      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const target = versionRow({
        id: 'version-2',
        version_number: 2,
        snapshot: null,
        patch: [{ op: 'add', path: '/content/1', value: 'b' }],
      });

      database.on(documentVersions).select.whenAsking(/snapshot IS NOT NULL/).returnsRaw([baseline]);
      database.on(documentVersions).select.whenAsking(/version_number >/).returnsRaw([target]);
      database.on(documentVersions).select.returnsRaw([target]);

      const replay = await replayVersionChain('doc-1', 'branch-1', 2);

      expect(replay?.snapshot).toEqual({ content: ['a', 'b'] });
      expect(replay?.reachedVersion).toBe(2);
      expect(replay?.brokenVersion).toBeUndefined();
    });

    it('replays the chain exactly once', async () => {
      const baseline = versionRow({ id: 'version-1', version_number: 1, snapshot: { content: ['a'] } });
      const hollow = versionRow({ id: 'version-2', version_number: 2, snapshot: null, patch: null });
      const target = versionRow({ id: 'version-3', version_number: 3, snapshot: null, patch: null });

      database.on(documentVersions).select.whenAsking(/snapshot IS NOT NULL/).returnsRaw([baseline]);
      database.on(documentVersions).select.whenAsking(/version_number >/).returnsRaw([hollow, target]);
      database.on(documentVersions).select.returnsRaw([target]);

      await replayVersionChain('doc-1', 'branch-1', 3);

      // Target lookup, baseline lookup, diff range — and nothing more. A
      // degraded read used to pay this sequence twice.
      expect(database.statements).toHaveLength(3);
    });
  });
});
