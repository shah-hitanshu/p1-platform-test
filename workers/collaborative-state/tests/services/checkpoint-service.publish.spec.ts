/**
 * Checkpoint Service: publishDocument Tests (TDD - Red State)
 *
 * Tests for the publishDocument function that cherry-picks a single document's
 * latest version from the source branch and publishes it on main.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeBranch } from '../helpers/branch';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock branch-service for getMainBranch and getBranch
vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
  getBranch: vi.fn(),
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
    snapshot: Record<string, unknown>;
    is_tombstone: boolean;
  }

  function createMockCheckpointRow(
    overrides: Partial<MockCheckpointRow> = {},
  ): MockCheckpointRow {
    return {
      id: 'checkpoint-publish-001',
      branch_id: 'main-branch-uuid',
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
      branch_id: 'source-branch-uuid',
      version_number: 3,
      snapshot: { title: 'Published content' },
      is_tombstone: false,
      ...overrides,
    };
  }

  it('should resolve the main branch and create checkpoint on main', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    // Mock getMainBranch to return main branch
    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    // Transaction flow:
    // BEGIN, get latest version on source branch, create version on main,
    // UPDATE source version with published_to_version_id,
    // insert checkpoint on main, insert checkpoint_documents, COMMIT
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version on source branch
      .mockResolvedValueOnce({ rows: [{ id: 'new-version-on-main', version_number: 8 }] }) // create version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [] }) // pin published version (pinned_at)
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint on main
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    vi.mocked(branchService.getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/test',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result).toBeDefined();
    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint.checkpointType).toBe('publish');
    // Checkpoint should be on main, not on the source branch
    expect(result.checkpoint.branchId).toBe('main-branch-uuid');
  });

  it('should copy the document version to main before creating the checkpoint', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({
      snapshot: { title: 'Branch content' },
    });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version on source
      .mockResolvedValueOnce({ rows: [{ id: 'copied-version-on-main', version_number: 4 }] }) // create version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [] }) // pin published version (pinned_at)
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    vi.mocked(branchService.getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/test',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // Find the INSERT into document_versions call (creating version on main)
    const allCalls = vi.mocked(db.query).mock.calls;
    const versionInsert = allCalls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('document_versions') &&
        call[0].includes('INSERT') &&
        !call[0].includes('checkpoint_documents'),
    );

    expect(versionInsert).toBeDefined();
    // Should reference main branch and use source='publish'
    if (versionInsert === undefined) throw new Error('unreachable');
    const sql: unknown = versionInsert[0];
    expect(sql).toContain('publish');
  });

  it('should use the published version on main for the checkpoint_documents row', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow({ id: 'cp-001' });
    const mockVersionRow = createMockVersionRow();

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version
      .mockResolvedValueOnce({ rows: [{ id: 'main-version-id', version_number: 5 }] }) // version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [] }) // pin published version (pinned_at)
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // checkpoint
      .mockResolvedValueOnce({ rows: [] }) // checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    vi.mocked(branchService.getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/test',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // The publishedVersionId should be the version created on main
    expect(result.publishedVersionId).toBe('main-version-id');
  });

  it('should skip version copy when already publishing on main', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({
      branch_id: 'main-branch-uuid',
    });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    // When publishing on main, no version copy needed — just checkpoint
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version (already on main)
      .mockResolvedValueOnce({ rows: [] }) // pin published version (pinned_at)
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await publishDocument({
      siteId: 'site-uuid',
      branchId: 'main-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    expect(result.checkpoint).toBeDefined();
    // Should use the existing version on main directly
    expect(result.publishedVersionId).toBe('version-uuid-latest');
  });

  it('should throw if document has no versions on source branch', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // no versions found

    await expect(
      publishDocument({
        siteId: 'site-uuid',
        branchId: 'source-branch-uuid',
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
    const branchService = await import('../../src/services/branch-service');

    const tombstoneVersion = createMockVersionRow({
      is_tombstone: true,
    });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [tombstoneVersion] }); // latest version is tombstone

    await expect(
      publishDocument({
        siteId: 'site-uuid',
        branchId: 'source-branch-uuid',
        documentId: 'doc-uuid-456',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow();
  });

  it('should throw if main branch is not found', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const branchService = await import('../../src/services/branch-service');

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(null);

    await expect(
      publishDocument({
        siteId: 'site-uuid',
        branchId: 'source-branch-uuid',
        documentId: 'doc-uuid-456',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      }),
    ).rejects.toThrow('Main branch not found');
  });
});
