/**
 * Phase 1.1: CRDT Sync Service Tests (TDD)
 *
 * Tests for syncing Durable Object CRDT state to PostgreSQL and loading
 * CRDT state from PostgreSQL for DO initialization.
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentVersionSource } from '../../src/types';
import { makeBranch } from '../helpers/branch';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock document service
vi.mock('../../src/services/document-service', () => ({
  getDocument: vi.fn(),
}));

// Mock document version service
vi.mock('../../src/services/document-version-service', () => ({
  createDocumentVersion: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestPublishedDocumentVersion: vi.fn(),
  reconstructVersionSnapshot: vi.fn(),
}));

// Mock branch service
vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn(),
}));

describe('Phase 1.1: CRDT Sync Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // =============================================================================
  // Types for testing
  // =============================================================================

  interface MockDocumentRow {
    id: string;
    site_id: string;
    path: string;
    created_at: string;
    archived_at: string | null;
  }

  interface MockDocumentVersionRow {
    id: string;
    document_id: string;
    branch_id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    source: DocumentVersionSource;
    created_by_id: string;
    created_by_type: 'user' | 'agent' | 'system';
    created_at: string;
  }

  function createMockDocument(overrides: Partial<MockDocumentRow> = {}): MockDocumentRow {
    return {
      id: 'doc-uuid-123',
      site_id: 'site-uuid-456',
      path: 'pages/home',
      created_at: '2026-01-25T10:00:00.000Z',
      archived_at: null,
      ...overrides,
    };
  }

  function createMockVersion(overrides: Partial<MockDocumentVersionRow> = {}): MockDocumentVersionRow {
    return {
      id: 'version-uuid-789',
      document_id: 'doc-uuid-123',
      branch_id: 'branch-uuid-456',
      version_number: 1,
      snapshot: { root: { title: 'Test' } },
      source: 'edit',
      created_by_id: 'user-uuid-001',
      created_by_type: 'user',
      created_at: '2026-01-25T10:00:00.000Z',
      ...overrides,
    };
  }

  // =============================================================================
  // SyncCrdtToPostgresParams interface tests
  // =============================================================================

  describe('SyncCrdtToPostgresParams', () => {
    it('should define required parameters for syncing CRDT state', async () => {
      const { syncCrdtToPostgres } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Mock getLatestDocumentVersion to return null (no existing version to compare)
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      const mockVersion = createMockVersion();
      vi.mocked(documentVersionService.createDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: mockVersion.snapshot,
        source: mockVersion.source,
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const params = {
        siteId: 'site-uuid-456',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Test Document' } },

        actorId: 'user-uuid-001',
        actorType: 'user' as const,
      };

      const result = await syncCrdtToPostgres(params);

      expect(result).toBeDefined();
      // getDocument is called with just the document ID, siteId validation happens in service
      expect(documentService.getDocument).toHaveBeenCalledWith('doc-uuid-123');
    });
  });

  // =============================================================================
  // syncCrdtToPostgres tests
  // =============================================================================

  describe('syncCrdtToPostgres', () => {
    it('should create a document version with snapshot and CRDT state', async () => {
      const { syncCrdtToPostgres } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Mock getLatestDocumentVersion to return null (no existing version to compare)
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      const mockVersion = createMockVersion({
        source: 'realtime',
      });
      vi.mocked(documentVersionService.createDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: mockVersion.snapshot,
        source: 'realtime',
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const result = await syncCrdtToPostgres({
        siteId: 'site-uuid-456',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Test' } },

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      expect(documentVersionService.createDocumentVersion).toHaveBeenCalledWith({
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: { title: 'Test' } },

        source: 'realtime',
        createdById: 'user-uuid-001',
        createdByType: 'user',
      });
      expect(result.source).toBe('realtime');
    });

    it('should throw DocumentNotFoundError when document does not exist', async () => {
      const { syncCrdtToPostgres, DocumentNotFoundError } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(documentService.getDocument).mockResolvedValue(null);

      await expect(
        syncCrdtToPostgres({
          siteId: 'site-uuid-456',
          documentId: 'nonexistent-doc-uuid',
          branchId: 'branch-uuid-456',
          snapshot: { root: {} },
          actorId: 'user-uuid-001',
          actorType: 'user',
        }),
      ).rejects.toThrow(DocumentNotFoundError);
    });

    it('should support agent actor type', async () => {
      const { syncCrdtToPostgres } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Mock getLatestDocumentVersion to return null (no existing version to compare)
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      const mockVersion = createMockVersion({
        created_by_type: 'agent',
        created_by_id: 'agent-uuid-001',
      });
      vi.mocked(documentVersionService.createDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: mockVersion.snapshot,
        source: 'realtime',
        createdById: 'agent-uuid-001',
        createdByType: 'agent',
        createdAt: mockVersion.created_at,
      });

      const result = await syncCrdtToPostgres({
        siteId: 'site-uuid-456',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: { root: {} },

        actorId: 'agent-uuid-001',
        actorType: 'agent',
      });

      expect(result.createdByType).toBe('agent');
      expect(documentVersionService.createDocumentVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          createdById: 'agent-uuid-001',
          createdByType: 'agent',
        }),
      );
    });

    it('should handle empty snapshot', async () => {
      const { syncCrdtToPostgres } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Mock getLatestDocumentVersion to return null (no existing version to compare)
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      const mockVersion = createMockVersion({ snapshot: {} });
      vi.mocked(documentVersionService.createDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: {},
        source: 'realtime',
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const result = await syncCrdtToPostgres({
        siteId: 'site-uuid-456',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: {},

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      expect(result.snapshot).toEqual({});
    });

    it('should return existing version when snapshot is unchanged (deduplication in document-version-service)', async () => {
      const { syncCrdtToPostgres } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Mock createDocumentVersion to return the existing version
      // (simulating deduplication behavior in document-version-service)
      const existingSnapshot = { root: { title: 'Same Content' } };
      const mockVersion = createMockVersion({ snapshot: existingSnapshot });
      vi.mocked(documentVersionService.createDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: existingSnapshot,
        source: 'realtime',
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const result = await syncCrdtToPostgres({
        siteId: 'site-uuid-456',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: existingSnapshot, // Same as latest version

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      // createDocumentVersion is called, but it returns existing version due to deduplication
      expect(documentVersionService.createDocumentVersion).toHaveBeenCalled();
      expect(result.id).toBe(mockVersion.id);
      expect(result.versionNumber).toBe(mockVersion.version_number);
    });

    it('should create new version when snapshot differs from latest version', async () => {
      const { syncCrdtToPostgres } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Mock getLatestDocumentVersion to return a version with DIFFERENT snapshot
      const existingSnapshot = { root: { title: 'Old Content' } };
      const newSnapshot = { root: { title: 'New Content' } };
      const existingVersion = createMockVersion({ snapshot: existingSnapshot, version_number: 1 });
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue({
        id: existingVersion.id,
        documentId: existingVersion.document_id,
        branchId: existingVersion.branch_id,
        versionNumber: 1,
        snapshot: existingSnapshot,
        source: 'realtime',
        createdById: existingVersion.created_by_id,
        createdByType: existingVersion.created_by_type,
        createdAt: existingVersion.created_at,
      });

      const newVersion = createMockVersion({ snapshot: newSnapshot, version_number: 2 });
      vi.mocked(documentVersionService.createDocumentVersion).mockResolvedValue({
        id: newVersion.id,
        documentId: newVersion.document_id,
        branchId: newVersion.branch_id,
        versionNumber: 2,
        snapshot: newSnapshot,
        source: 'realtime',
        createdById: newVersion.created_by_id,
        createdByType: newVersion.created_by_type,
        createdAt: newVersion.created_at,
      });

      const result = await syncCrdtToPostgres({
        siteId: 'site-uuid-456',
        documentId: 'doc-uuid-123',
        branchId: 'branch-uuid-456',
        snapshot: newSnapshot, // Different from latest version

        actorId: 'user-uuid-001',
        actorType: 'user',
      });

      // Should create a new version
      expect(documentVersionService.createDocumentVersion).toHaveBeenCalled();
      expect(result.versionNumber).toBe(2);
    });
  });

  // =============================================================================
  // loadLatestCrdtState tests
  // =============================================================================

  describe('loadLatestCrdtState', () => {
    it('should return snapshot and CRDT state from latest version', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      const mockVersion = createMockVersion();
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: mockVersion.snapshot,
        source: mockVersion.source,
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual({ root: { title: 'Test' } });
    });

    it('should return null when document does not exist', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(documentService.getDocument).mockResolvedValue(null);

      const result = await loadLatestCrdtState('site-uuid-456', 'nonexistent-doc-uuid', 'branch-uuid-456');

      expect(result).toBeNull();
    });

    it('should return null when no versions exist for document on branch', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).toBeNull();
    });

    it('should use correct document lookup parameters', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      // Create mock document with matching siteId for validation to pass
      const mockDoc = createMockDocument({ site_id: 'my-site-id' });
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      await loadLatestCrdtState('my-site-id', 'my-doc-uuid', 'my-branch-id');

      // getDocument is called with just the document ID
      expect(documentService.getDocument).toHaveBeenCalledWith('my-doc-uuid');
      // getLatestDocumentVersion is called with document.id from the returned document
      expect(documentVersionService.getLatestDocumentVersion).toHaveBeenCalledWith(
        'doc-uuid-123', // document ID from mock
        'my-branch-id',
      );
    });
  });

  // =============================================================================
  // loadLatestCrdtState — CoW fallback tests
  // =============================================================================

  describe('loadLatestCrdtState — CoW fallback', () => {
    it('should return baseline snapshot when branch has no versions and has sourceBranchId', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');
      const branchService = await import('../../src/services/branch-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // No version on the requested branch
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      // Branch has a sourceBranchId (it was created from main)
      vi.mocked(branchService.getBranch).mockResolvedValue(makeBranch({
        id: 'branch-uuid-456',
        siteId: mockDoc.site_id,
        name: 'feature-branch',
        status: 'active',
        isMain: false,
        sourceBranchId: 'main-branch-id',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
        updatedAt: '2026-01-25T10:00:00.000Z',
      }));

      // Published version exists on the source branch
      const sourceSnapshot = { root: { title: 'CoW Baseline' } };
      const mockVersion = createMockVersion({ snapshot: sourceSnapshot, branch_id: 'main-branch-id' });
      vi.mocked(documentVersionService.getLatestPublishedDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: 'main-branch-id',
        versionNumber: mockVersion.version_number,
        snapshot: sourceSnapshot,
        source: mockVersion.source,
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual(sourceSnapshot);
      expect(documentVersionService.getLatestPublishedDocumentVersion).toHaveBeenCalledWith(
        mockDoc.id,
        'main-branch-id',
      );
    });

    it('should return null when branch is main (no sourceBranchId)', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');
      const branchService = await import('../../src/services/branch-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // No version on main
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      // Branch is main — no sourceBranchId
      vi.mocked(branchService.getBranch).mockResolvedValue(makeBranch({
        id: 'main-branch-id',
        siteId: mockDoc.site_id,
        name: 'main',
        status: 'active',
        isMain: true,
        sourceBranchId: undefined,
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
        updatedAt: '2026-01-25T10:00:00.000Z',
      }));

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'main-branch-id');

      expect(result).toBeNull();
      // CoW lookup should not be attempted for main
      expect(documentVersionService.getLatestPublishedDocumentVersion).not.toHaveBeenCalled();
    });

    it('should return null when branch has no versions and no sourceBranchId (new feature branch with no source)', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');
      const branchService = await import('../../src/services/branch-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      // Non-main branch but sourceBranchId is absent
      vi.mocked(branchService.getBranch).mockResolvedValue(makeBranch({
        id: 'orphan-branch-id',
        siteId: mockDoc.site_id,
        name: 'orphan-branch',
        status: 'active',
        isMain: false,
        sourceBranchId: undefined,
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
        updatedAt: '2026-01-25T10:00:00.000Z',
      }));

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'orphan-branch-id');

      expect(result).toBeNull();
      expect(documentVersionService.getLatestPublishedDocumentVersion).not.toHaveBeenCalled();
    });

    it('should return null when branch has no versions and published version is also absent on source branch', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');
      const branchService = await import('../../src/services/branch-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      vi.mocked(branchService.getBranch).mockResolvedValue(makeBranch({
        id: 'branch-uuid-456',
        siteId: mockDoc.site_id,
        name: 'feature-branch',
        status: 'active',
        isMain: false,
        sourceBranchId: 'main-branch-id',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
        updatedAt: '2026-01-25T10:00:00.000Z',
      }));

      // No published version on source branch either
      vi.mocked(documentVersionService.getLatestPublishedDocumentVersion).mockResolvedValue(null);

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).toBeNull();
    });

    it('should return branch version directly and NOT call getBranch when a version exists on the branch', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');
      const branchService = await import('../../src/services/branch-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // A version already exists on the branch — no CoW needed
      const branchSnapshot = { root: { title: 'Branch Content' } };
      const mockVersion = createMockVersion({ snapshot: branchSnapshot });
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue({
        id: mockVersion.id,
        documentId: mockVersion.document_id,
        branchId: mockVersion.branch_id,
        versionNumber: mockVersion.version_number,
        snapshot: branchSnapshot,
        source: mockVersion.source,
        createdById: mockVersion.created_by_id,
        createdByType: mockVersion.created_by_type,
        createdAt: mockVersion.created_at,
      });

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual(branchSnapshot);
      // CoW path must not be triggered when a version exists
      expect(branchService.getBranch).not.toHaveBeenCalled();
      expect(documentVersionService.getLatestPublishedDocumentVersion).not.toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Null-snapshot handling (regression tests)
  // These cover the case where a version's snapshot has been nulled (diff-only
  // storage) and must be reconstructed before being returned.
  // =============================================================================

  describe('loadLatestCrdtState — null snapshot reconstruction', () => {
    it('reconstructs snapshot via reconstructVersionSnapshot when CoW published version has null snapshot', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');
      const branchService = await import('../../src/services/branch-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue(null);

      vi.mocked(branchService.getBranch).mockResolvedValue(makeBranch({
        id: 'branch-uuid-456',
        siteId: mockDoc.site_id,
        name: 'feature-branch',
        status: 'active',
        isMain: false,
        sourceBranchId: 'main-branch-id',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
        updatedAt: '2026-01-25T10:00:00.000Z',
      }));

      // Published version has null snapshot (nulled during diff compaction)
      vi.mocked(documentVersionService.getLatestPublishedDocumentVersion).mockResolvedValue({
        id: 'version-uuid-pub',
        documentId: mockDoc.id,
        branchId: 'main-branch-id',
        versionNumber: 22,
        snapshot: null,
        source: 'publish',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-20T10:00:00.000Z',
      });

      const reconstructed = { root: { title: 'Reconstructed Published' } };
      vi.mocked(documentVersionService.reconstructVersionSnapshot).mockResolvedValue(reconstructed);

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual(reconstructed);
      expect(documentVersionService.reconstructVersionSnapshot).toHaveBeenCalledWith(
        mockDoc.id,
        'main-branch-id',
        22,
      );
    });

    it('reconstructs snapshot via reconstructVersionSnapshot when branch version has null snapshot', async () => {
      const { loadLatestCrdtState } = await import('../../src/services/crdt-sync-service');
      const documentService = await import('../../src/services/document-service');
      const documentVersionService = await import('../../src/services/document-version-service');

      const mockDoc = createMockDocument();
      vi.mocked(documentService.getDocument).mockResolvedValue({
        id: mockDoc.id,
        siteId: mockDoc.site_id,
        path: mockDoc.path,
        createdAt: mockDoc.created_at,
      });

      // Branch has a version but snapshot is null (diff-only compaction)
      vi.mocked(documentVersionService.getLatestDocumentVersion).mockResolvedValue({
        id: 'version-uuid-branch',
        documentId: mockDoc.id,
        branchId: 'branch-uuid-456',
        versionNumber: 5,
        snapshot: null,
        source: 'realtime',
        createdById: 'user-uuid-001',
        createdByType: 'user',
        createdAt: '2026-01-25T10:00:00.000Z',
      });

      const reconstructed = { root: { title: 'Reconstructed Branch' } };
      vi.mocked(documentVersionService.reconstructVersionSnapshot).mockResolvedValue(reconstructed);

      const result = await loadLatestCrdtState('site-uuid-456', 'doc-uuid-123', 'branch-uuid-456');

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual(reconstructed);
      expect(documentVersionService.reconstructVersionSnapshot).toHaveBeenCalledWith(
        mockDoc.id,
        'branch-uuid-456',
        5,
      );
    });
  });

  // =============================================================================
  // Error classes tests
  // =============================================================================

  describe('Error classes', () => {
    it('should export DocumentNotFoundError', async () => {
      const { DocumentNotFoundError } = await import('../../src/services/crdt-sync-service');

      const error = new DocumentNotFoundError('pages/home');
      expect(error.name).toBe('DocumentNotFoundError');
      expect(error.message).toContain('pages/home');
      expect(error.documentId).toBe('pages/home');
    });

    it('should export SyncError for general sync failures', async () => {
      const { SyncError } = await import('../../src/services/crdt-sync-service');

      const error = new SyncError('Failed to sync CRDT state');
      expect(error.name).toBe('SyncError');
      expect(error.message).toBe('Failed to sync CRDT state');
    });
  });
});
