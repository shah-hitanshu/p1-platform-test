/**
 * Tests for restoreDocumentVersion service function.
 *
 * Covers: success path, patch-only snapshot reconstruction,
 * not-found, and branch/document mismatch validation.
 *
 * Every read runs against the stub database, so the reconstruction and the
 * version write are exercised as written rather than replaced.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documentVersions } from '../../src/db/schema';
import { restoreDocumentVersion } from '../../src/services/document-version-service';
import { DatabaseError, RestoreVersionNotFoundError } from '../../src/services/errors';


describe('restoreDocumentVersion', () => {
  let database: DatabaseStub;

  beforeEach(() => {
    database = stubDatabase();
  });

  type MockDocumentVersionRow = {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown> | null;
    source: DocumentVersionSource;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
    patch?: unknown[] | null;
    action_type?: string | null;
    action_metadata?: Record<string, unknown> | null;
    source_version_id?: string | null;
    is_published?: boolean;
    is_tombstone?: boolean;
  };

  function createMockRow(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
    return {
      id: 'version-uuid-123',
      document_id: 'doc-uuid-456',
      branch_id: 'branch-uuid-789',
      version_number: 2,
      snapshot: { title: 'Old Content', content: [] },
      source: 'edit',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-20T10:00:00.000Z',
      source_version_id: null,
      is_published: false,
      is_tombstone: false,
      ...overrides,
    };
  }

  /**
   * restoreDocumentVersion's target-row read (getDocumentVersion) goes through
   * the Drizzle query builder, which names columns as the schema does.
   */
  function stubTargetRow(row: MockDocumentVersionRow): void {
    database.on(documentVersions).select.returnsRaw([{
      id: row.id,
      documentId: row.document_id,
      branchId: row.branch_id,
      versionNumber: row.version_number,
      snapshot: row.snapshot,
      patch: row.patch ?? null,
      actionType: row.action_type ?? null,
      actionMetadata: row.action_metadata ?? null,
      source: row.source,
      createdById: row.created_by_id,
      createdByType: row.created_by_type,
      createdAt: new Date(row.created_at),
      isTombstone: row.is_tombstone ?? false,
      sourceBranchId: null,
      sourceVersionId: row.source_version_id ?? null,
      publishedToVersionId: null,
      sourceBranchName: null,
      isPublished: row.is_published ?? false,
    }]);
  }

  it('should create a new version with source=revert and sourceVersionId pointing to the restored version', async () => {
    const targetRow = createMockRow({ id: 'target-version-uuid' });
    const newVersionRow = createMockRow({
      id: 'new-version-uuid',
      version_number: 5,
      source: 'revert',
      source_version_id: 'target-version-uuid',
    });

    stubTargetRow(targetRow);
    database.on(documentVersions).insert.returnsRaw([newVersionRow]);

    const result = await restoreDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      versionId: 'target-version-uuid',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result.source).toBe('revert');
    expect(result.sourceVersionId).toBe('target-version-uuid');
    expect(result.versionNumber).toBe(5);
    expect(result.id).toBe('new-version-uuid');
  });

  it('should reconstruct the snapshot when the target version is patch-only (null snapshot)', async () => {
    const reconstructedSnapshot = { title: 'Reconstructed', content: [{ type: 'Hero' }] };
    const patchOnlyRow = createMockRow({
      id: 'patch-only-version-uuid',
      version_number: 3,
      snapshot: null,
    });
    // reconstructVersionSnapshot calls getDocumentVersionByNumber — return a row WITH a snapshot
    // so it returns that snapshot immediately without further queries.
    const reconstructedRow = createMockRow({
      id: 'patch-only-version-uuid',
      version_number: 3,
      snapshot: reconstructedSnapshot,
    });
    const newVersionRow = createMockRow({
      id: 'new-version-uuid',
      version_number: 6,
      source: 'revert',
      source_version_id: 'patch-only-version-uuid',
      snapshot: reconstructedSnapshot,
    });

    stubTargetRow(patchOnlyRow);
    // The reconstruction reads the version by number, and that row carries the
    // snapshot, so the chain stops there.
    database.on(documentVersions).select
      .whenAsking(/version_number = /)
      .returnsRaw([reconstructedRow]);
    database.on(documentVersions).insert.returnsRaw([newVersionRow]);

    const result = await restoreDocumentVersion({
      documentId: 'doc-uuid-456',
      branchId: 'branch-uuid-789',
      versionId: 'patch-only-version-uuid',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result.versionNumber).toBe(6);
    expect(result.source).toBe('revert');
    expect(result.sourceVersionId).toBe('patch-only-version-uuid');
    expect(result.snapshot).toEqual(reconstructedSnapshot);
  });

  it('should throw RestoreVersionNotFoundError when the target version does not exist', async () => {

    // getDocumentVersion returns null (no matching row; default stub is empty)

    await expect(
      restoreDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        versionId: 'nonexistent-version-uuid',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow(RestoreVersionNotFoundError);
  });

  it('should throw RestoreVersionNotFoundError when version belongs to a different document', async () => {

    const wrongDocRow = createMockRow({ document_id: 'DIFFERENT-doc-uuid' });
    stubTargetRow(wrongDocRow);

    await expect(
      restoreDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        versionId: 'version-uuid',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow(RestoreVersionNotFoundError);
  });

  it('should throw RestoreVersionNotFoundError when version belongs to a different branch', async () => {

    const wrongBranchRow = createMockRow({ branch_id: 'DIFFERENT-branch-uuid' });
    stubTargetRow(wrongBranchRow);

    await expect(
      restoreDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        versionId: 'version-uuid',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow(RestoreVersionNotFoundError);
  });

  it('should throw RestoreVersionNotFoundError when the target version is a tombstone', async () => {

    const tombstoneRow = createMockRow({
      id: 'tombstone-version-uuid',
      snapshot: null,
      is_tombstone: true,
    });
    stubTargetRow(tombstoneRow);

    await expect(
      restoreDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        versionId: 'tombstone-version-uuid',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow(RestoreVersionNotFoundError);
  });

  it('should throw DatabaseError when createDocumentVersion returns a version from the concurrent-write fallback', async () => {
    // Note: this test exercises the guard condition (sourceVersionId/source mismatch), not the
    // precise unique-violation fallback path in createDocumentVersion. The real fallback requires
    // the INSERT to throw a PG unique-violation error followed by a getLatestDocumentVersion query.
    // That path is covered by createDocumentVersion's own tests; here we verify that any mismatch
    // returned to restoreDocumentVersion is caught and surfaced as a DatabaseError.
    const targetRow = createMockRow({ id: 'target-version-uuid' });
    // Simulate a mismatched version being returned (wrong source/sourceVersionId)
    const unrelatedRow = createMockRow({
      id: 'unrelated-latest-uuid',
      version_number: 7,
      source: 'edit',
      source_version_id: null,
    });

    stubTargetRow(targetRow);
    database.on(documentVersions).insert.returnsRaw([unrelatedRow]);

    await expect(
      restoreDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        versionId: 'target-version-uuid',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow(DatabaseError);
  });

  it('should throw RestoreVersionNotFoundError when snapshot cannot be reconstructed for a patch-only version', async () => {
    const patchOnlyRow = createMockRow({
      id: 'patch-only-uuid',
      version_number: 3,
      snapshot: null,
    });

    stubTargetRow(patchOnlyRow);
    // The reconstruction finds no row at that version number.
    database.on(documentVersions).select.whenAsking(/version_number = /).returnsRaw([]);

    await expect(
      restoreDocumentVersion({
        documentId: 'doc-uuid-456',
        branchId: 'branch-uuid-789',
        versionId: 'patch-only-uuid',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow(RestoreVersionNotFoundError);
  });
});
