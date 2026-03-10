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

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock branch-service for getMainBranch
vi.mock('../../src/services/branch-service', () => ({
  getMainBranch: vi.fn(),
}));

describe('publishDocument provenance tracking', () => {
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
    crdt_state: Buffer | null;
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
      crdt_state: null,
      is_tombstone: false,
      ...overrides,
    };
  }

  interface MainBranchResult {
    id: string;
    siteId: string;
    name: string;
    status: string;
    isMain: boolean;
    createdById: string;
    createdByType: string;
    createdAt: string;
    updatedAt: string;
  }

  function createMainBranch(): MainBranchResult {
    return {
      id: 'main-branch-uuid',
      siteId: 'site-uuid',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'system',
      createdByType: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('should set source_branch_id on the version copied to main', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version on source branch
      .mockResolvedValueOnce({
        rows: [{ id: 'new-version-on-main', version_number: 8 }],
      }) // create version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint on main
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

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

    if (versionInsert === undefined) throw new Error('Expected version INSERT call');
    // The INSERT SQL should include source_branch_id column
    const sql: unknown = versionInsert[0];
    expect(sql).toContain('source_branch_id');
    // The parameters should include the source branch ID
    if (versionInsert[1] === undefined) throw new Error('Expected params');
    const params: unknown = versionInsert[1];
    expect(params).toContain('source-branch-uuid');
  });

  it('should set source_version_id on the version copied to main', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({ id: 'source-ver-id-999' });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version on source branch
      .mockResolvedValueOnce({
        rows: [{ id: 'new-version-on-main', version_number: 5 }],
      }) // create version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint on main
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

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

    if (versionInsert === undefined) throw new Error('Expected version INSERT call');
    // The INSERT SQL should include source_version_id column
    const sql: unknown = versionInsert[0];
    expect(sql).toContain('source_version_id');
    // The parameters should include the source version ID
    if (versionInsert[1] === undefined) throw new Error('Expected params');
    const params: unknown = versionInsert[1];
    expect(params).toContain('source-ver-id-999');
  });

  it('should update the source version with published_to_version_id', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({ id: 'source-ver-original' });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version on source branch
      .mockResolvedValueOnce({
        rows: [{ id: 'main-ver-new-001', version_number: 6 }],
      }) // create version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint on main
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // Find the UPDATE query that sets published_to_version_id on the source version
    const allCalls = vi.mocked(db.query).mock.calls;
    const updateCall = allCalls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE') &&
        call[0].includes('published_to_version_id'),
    );

    if (updateCall === undefined) throw new Error('Expected UPDATE call for published_to_version_id');
    const sql: unknown = updateCall[0];
    expect(sql).toContain('document_versions');
    // The UPDATE should set published_to_version_id to the new main version's ID
    if (updateCall[1] === undefined) throw new Error('Expected params');
    const params: unknown = updateCall[1];
    expect(params).toContain('main-ver-new-001');
    // And target the source version
    expect(params).toContain('source-ver-original');
  });

  it('should NOT set source_branch_id when publishing on main', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({
      branch_id: 'main-branch-uuid',
    });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    // When publishing on main, no version copy needed — just checkpoint
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version (already on main)
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'main-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // No INSERT into document_versions should include source_branch_id
    const allCalls = vi.mocked(db.query).mock.calls;
    const versionInsert = allCalls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('document_versions') &&
        call[0].includes('INSERT'),
    );

    // When on main, there should be no version copy INSERT at all
    expect(versionInsert).toBeUndefined();
  });

  it('should NOT update published_to_version_id when publishing on main', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow({
      branch_id: 'main-branch-uuid',
    });

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    // When publishing on main, no version copy or back-link needed
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version (already on main)
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await publishDocument({
      siteId: 'site-uuid',
      branchId: 'main-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // No UPDATE with published_to_version_id should have been called
    const allCalls = vi.mocked(db.query).mock.calls;
    const updateCall = allCalls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE') &&
        call[0].includes('published_to_version_id'),
    );

    expect(updateCall).toBeUndefined();
  });

  it('should include sourceBranchName in the result', async () => {
    const { publishDocument } = await import(
      '../../src/services/checkpoint-service'
    );
    const db = await import('../../src/db');
    const branchService = await import('../../src/services/branch-service');

    const mockCheckpointRow = createMockCheckpointRow();
    const mockVersionRow = createMockVersionRow();

    vi.mocked(branchService.getMainBranch).mockResolvedValueOnce(
      createMainBranch(),
    );

    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [mockVersionRow] }) // get latest version on source branch
      .mockResolvedValueOnce({
        rows: [{ id: 'new-version-on-main', version_number: 8 }],
      }) // create version on main
      .mockResolvedValueOnce({ rows: [] }) // UPDATE source version with published_to_version_id
      .mockResolvedValueOnce({ rows: [mockCheckpointRow] }) // insert checkpoint on main
      .mockResolvedValueOnce({ rows: [] }) // insert checkpoint_documents
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await publishDocument({
      siteId: 'site-uuid',
      branchId: 'source-branch-uuid',
      documentId: 'doc-uuid-456',
      createdById: 'user-uuid-001',
      createdByType: 'user',
    });

    // The result should include the source branch name for display purposes
    expect(result.sourceBranchName).toBeDefined();
  });
});
