/**
 * Checkpoint Service: publishDocument Provenance Tracking Tests (TDD - Red State)
 *
 * Tests for provenance columns (source_branch_id, source_version_id,
 * published_to_version_id, source_branch_name) that track the lineage
 * of versions created during cross-branch publishing.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeBranch } from '../helpers/branch';
import type { Branch } from '../../src/types';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { checkpoints, documentVersions } from '../../src/db/schema';
import { publishDocument } from '../../src/services/checkpoint-service';
import { getBranch, getMainBranch } from '../../src/services/branch-service';

// Mock branch-service for getMainBranch and getBranch
vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
  getBranch: vi.fn(),
}));

describe('publishDocument provenance tracking', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = stubDatabase();
  });

  // Mock row types matching database format
  // Type aliases rather than interfaces: the stub takes rows as
  // Record<string, unknown>, which an interface cannot satisfy because it
  // carries no implicit index signature.
  type MockCheckpointRow = {
    id: string;
    branch_id: string;
    name: string | null;
    message: string | null;
    checkpoint_type: string;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
  };

  type MockDocumentVersionRow = {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    is_tombstone: boolean;
  };

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
      created_at: '2026-03-10T10:00:00.000Z',
      ...overrides,
    };
  }

  function createMockVersionRow(
    overrides: Partial<MockDocumentVersionRow> = {},
  ): MockDocumentVersionRow {
    return {
      id: 'version-uuid-source',
      document_id: 'doc-uuid-456',
      branch_id: 'source-branch-uuid',
      version_number: 3,
      snapshot: { title: 'Published content' },
      is_tombstone: false,
      ...overrides,
    };
  }

  function createMainBranch(): Branch {
    return makeBranch({
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('should set source_branch_id on the version copied to main', async () => {
    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    vi.mocked(getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );
    vi.mocked(getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/test',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    stub.on(documentVersions).select.returnsRaw([mockVersionRow]);
    stub.on(documentVersions).insert.returnsRaw([{ id: 'new-version-on-main', version_number: 8 }]);
    stub.on(checkpoints).insert.returnsRaw([mockCheckpointRow]);

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const [versionInsert] = stub.calls(documentVersions).insert;

    // The INSERT SQL should include source_branch_id column
    const { sql } = versionInsert;
    expect(sql).toContain('source_branch_id');
    // The parameters should include the source branch ID
    const { params } = versionInsert;
    expect(params).toContain('source-branch-uuid');
  });

  it('should set source_version_id on the version copied to main', async () => {
    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({ id: 'source-ver-id-999' });

    vi.mocked(getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );
    vi.mocked(getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/test',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    stub.on(documentVersions).select.returnsRaw([mockVersionRow]);
    stub.on(documentVersions).insert.returnsRaw([{ id: 'new-version-on-main', version_number: 5 }]);
    stub.on(checkpoints).insert.returnsRaw([mockCheckpointRow]);

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const [versionInsert] = stub.calls(documentVersions).insert;

    // The INSERT SQL should include source_version_id column
    const { sql } = versionInsert;
    expect(sql).toContain('source_version_id');
    // The parameters should include the source version ID
    const { params } = versionInsert;
    expect(params).toContain('source-ver-id-999');
  });

  it('should update the source version with published_to_version_id', async () => {
    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({ id: 'source-ver-original' });

    vi.mocked(getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );
    vi.mocked(getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/test',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    stub.on(documentVersions).select.returnsRaw([mockVersionRow]);
    stub.on(documentVersions).insert.returnsRaw([{ id: 'main-ver-new-001', version_number: 6 }]);
    stub.on(checkpoints).insert.returnsRaw([mockCheckpointRow]);

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // Find the UPDATE query that sets published_to_version_id on the source version
    const updateCall = stub.calls(documentVersions).update.find(
      (call) => call.sql.includes('published_to_version_id'),
    );

    if (updateCall === undefined) throw new Error('Expected UPDATE call for published_to_version_id');
    // The UPDATE should set published_to_version_id to the new main version's ID
    const { params } = updateCall;
    expect(params).toContain('main-ver-new-001');
    // And target the source version
    expect(params).toContain('source-ver-original');
  });

  it('should NOT set source_branch_id when publishing on main', async () => {
    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({
      branch_id: 'main-branch-uuid',
    });

    vi.mocked(getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    stub.on(documentVersions).select.returnsRaw([mockVersionRow]);
    stub.on(checkpoints).insert.returnsRaw([mockCheckpointRow]);

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'main-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    const [versionInsert] = stub.calls(documentVersions).insert;

    // When on main, there should be no version copy INSERT at all
    expect(versionInsert).toBeUndefined();
  });

  it('should NOT update published_to_version_id when publishing on main', async () => {
    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({
      branch_id: 'main-branch-uuid',
    });

    vi.mocked(getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    stub.on(documentVersions).select.returnsRaw([mockVersionRow]);
    stub.on(checkpoints).insert.returnsRaw([mockCheckpointRow]);

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'main-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // No UPDATE with published_to_version_id should have been called
    const updateCall = stub.calls(documentVersions).update.find(
      (call) => call.sql.includes('published_to_version_id'),
    );

    expect(updateCall).toBeUndefined();
  });

  it('should include sourceBranchName in the result', async () => {
    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    vi.mocked(getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );
    vi.mocked(getBranch).mockResolvedValueOnce(makeBranch({
      id: 'source-branch-uuid', siteId: 'site-uuid', name: 'feature/my-branch',
      status: 'active', isMain: false, createdById: 'user-1', createdByType: 'user',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }));

    stub.on(documentVersions).select.returnsRaw([mockVersionRow]);
    stub.on(documentVersions).insert.returnsRaw([{ id: 'new-version-on-main', version_number: 8 }]);
    stub.on(checkpoints).insert.returnsRaw([mockCheckpointRow]);

    const result = await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // The result should include the source branch name for display purposes
    expect(result.sourceBranchName).toBe('feature/my-branch');
  });
});
