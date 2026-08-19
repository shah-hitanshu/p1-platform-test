/**
 * Tests for restoreDocumentVersion service function.
 *
 * Covers: success path, patch-only snapshot reconstruction,
 * not-found, and branch/document mismatch validation.
 *
 * Mocks db.query directly (not the service module) so internal function
 * calls within the service are exercised as-is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('restoreDocumentVersion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  interface MockDocumentVersionRow {
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
  }

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

  it('should create a new version with source=revert and sourceVersionId pointing to the restored version', async () => {
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');

    const targetRow = createMockRow({ id: 'target-version-uuid' });
    const newVersionRow = createMockRow({
      id: 'new-version-uuid',
      version_number: 5,
      source: 'revert',
      source_version_id: 'target-version-uuid',
    });

    // Query 1: getDocumentVersion SELECT by id
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [targetRow] });
    // Query 2: createDocumentVersion INSERT (skipDuplicateCheck=true, no extra queries)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [newVersionRow] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const db = await import('../../src/db');

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

    // Query 1: getDocumentVersion SELECT by id (null snapshot)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [patchOnlyRow] });
    // Query 2: getDocumentVersionByNumber inside reconstructVersionSnapshot (returns snapshot → early return)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [reconstructedRow] });
    // Query 3: createDocumentVersion INSERT
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [newVersionRow] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const { RestoreVersionNotFoundError } = await import('../../src/services/errors');
    const db = await import('../../src/db');

    // getDocumentVersion returns null (empty rows)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const { RestoreVersionNotFoundError } = await import('../../src/services/errors');
    const db = await import('../../src/db');

    const wrongDocRow = createMockRow({ document_id: 'DIFFERENT-doc-uuid' });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [wrongDocRow] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const { RestoreVersionNotFoundError } = await import('../../src/services/errors');
    const db = await import('../../src/db');

    const wrongBranchRow = createMockRow({ branch_id: 'DIFFERENT-branch-uuid' });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [wrongBranchRow] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const { RestoreVersionNotFoundError } = await import('../../src/services/errors');
    const db = await import('../../src/db');

    const tombstoneRow = createMockRow({
      id: 'tombstone-version-uuid',
      snapshot: null,
      is_tombstone: true,
    });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [tombstoneRow] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const { DatabaseError } = await import('../../src/services/errors');
    const db = await import('../../src/db');

    const targetRow = createMockRow({ id: 'target-version-uuid' });
    // Simulate a mismatched version being returned (wrong source/sourceVersionId)
    const unrelatedRow = createMockRow({
      id: 'unrelated-latest-uuid',
      version_number: 7,
      source: 'edit',
      source_version_id: null,
    });

    vi.mocked(db.query).mockResolvedValueOnce({ rows: [targetRow] });
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [unrelatedRow] });

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
    const { restoreDocumentVersion } = await import('../../src/services/document-version-service');
    const { RestoreVersionNotFoundError } = await import('../../src/services/errors');
    const db = await import('../../src/db');

    const patchOnlyRow = createMockRow({
      id: 'patch-only-uuid',
      version_number: 3,
      snapshot: null,
    });

    // Query 1: getDocumentVersion (null snapshot)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [patchOnlyRow] });
    // Query 2: getDocumentVersionByNumber inside reconstructVersionSnapshot — returns null (not found)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] });

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
