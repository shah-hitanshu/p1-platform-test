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
