/**
 * Checkpoint Service: publishDocument Tests (TDD - Red State)
 *
 * Tests for the publishDocument function that creates a publish-type checkpoint
 * capturing a single document's latest version on a branch.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('publishDocument', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  // Mock row types matching database format
  interface MockCheckpointRow {
    id: string;
    branch_id: string;
    name: string | null;
    message: string | null;
    checkpoint_type: string;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
  }

  interface MockDocumentVersionRow {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    is_tombstone: boolean;
  }

  function createMockCheckpointRow(
    overrides: Partial<MockCheckpointRow> = {},
  ): MockCheckpointRow {
    return {
      id: 'checkpoint-publish-001',
      branch_id: 'branch-uuid-789',
      name: null,
      message: null,
      checkpoint_type: 'publish',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-03-09T10:00:00.000Z',
      ...overrides,
    };
  }

  function createMockVersionRow(
    overrides: Partial<MockDocumentVersionRow> = {},
  ): MockDocumentVersionRow {
    return {
      id: 'version-uuid-latest',
      document_id: 'doc-uuid-456',
      branch_id: 'branch-uuid-789',
      version_number: 3,
      is_tombstone: false,
      ...overrides,
    };
  }

  it('should create a checkpoint with type "publish" for the document', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    // Transaction flow: BEGIN, get latest version, insert checkpoint, insert checkpoint_documents, COMMIT
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest non-tombstone version
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint with type 'publish'
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await publishDocument({
      branchId: 'branch-uuid-789',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result).toBeDefined();
    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint.checkpointType).toBe('publish');
    expect(result.publishedVersionId).toBeDefined();
  });

  it('should insert exactly one checkpoint_documents row', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest non-tombstone version
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await publishDocument({
      branchId: 'branch-uuid-789',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // Find the INSERT into checkpoint_documents call
    const allCalls = vi.mocked(db.query).mock.calls;
    const checkpointDocInsert = allCalls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('checkpoint_documents') &&
        call[0].includes('INSERT'),
    );

    expect(checkpointDocInsert).toBeDefined();
    // Should reference exactly one document version - the params should contain
    // the checkpoint ID, the document ID, and the version ID (3 values for 1 row)
    const params = checkpointDocInsert![1] as unknown[];
    expect(params).toHaveLength(3);
  });

  it('should use the latest non-tombstone version of the document', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');

    const mockCheckpointRow = createMockCheckpointRow();
    const latestVersion = createMockVersionRow({
      id: 'version-uuid-latest-v5',
      version_number: 5,
      is_tombstone: false,
    });

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [latestVersion] }) // get latest non-tombstone version
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await publishDocument({
      branchId: 'branch-uuid-789',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result.publishedVersionId).toBe('version-uuid-latest-v5');
  });

  it('should throw if document has no versions on branch', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // no versions found

    await expect(
      publishDocument({
        branchId: 'branch-uuid-789',
        documentId: 'doc-uuid-456',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow();
  });

  it('should throw if latest version is a tombstone', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');

    const tombstoneVersion = createMockVersionRow({
      is_tombstone: true,
    });

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [tombstoneVersion] }); // latest version is tombstone

    await expect(
      publishDocument({
        branchId: 'branch-uuid-789',
        documentId: 'doc-uuid-456',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow();
  });
});
