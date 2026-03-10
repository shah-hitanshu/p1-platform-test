/**
 * Content Delivery API Routes Tests
 *
 * Tests for content delivery endpoints:
 *   GET /api/sites/{siteId}/content/{documentPath}
 *   GET /api/sites/{siteId}/content-pages
 *
 * Main branch: serves only published (checkpoint-captured) versions.
 * Non-main branches: serves latest saved version (work-in-progress).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedPrincipal, Branch, Document, DocumentVersion } from '../../src/types';

// Mock services
vi.mock('../../src/services', () => ({
  getMainBranch: vi.fn(),
  getBranch: vi.fn(),
  getDocumentByPath: vi.fn(),
  getLatestDocumentVersion: vi.fn(),
  getLatestPublishedDocumentVersion: vi.fn(),
  getLatestDocumentVersionWithFallback: vi.fn(),
  listDocumentsOnBranch: vi.fn(),
}));

vi.mock('../../src/services/site-settings-service', () => ({
  getSiteSettings: vi.fn(),
  getEffectiveCacheTtl: vi.fn(),
}));

// =============================================================================
// Test Data
// =============================================================================

const mockServicePrincipal: AuthenticatedPrincipal = {
  id: 'service-bot',
  type: 'service',
  authProvider: 'site_token',
  pantheonSiteRoles: { 'site-uuid-123': 'admin' },
  tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
  scopes: ['read:published'],
  siteId: 'site-uuid-123',
};

const mockMainBranch: Branch = {
  id: 'branch-main-uuid',
  siteId: 'site-uuid-123',
  name: 'main',
  isMain: true,
  status: 'active',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockFeatureBranch: Branch = {
  id: 'branch-feature-uuid',
  siteId: 'site-uuid-123',
  name: 'feature-redesign',
  isMain: false,
  status: 'active',
  sourceBranchId: 'branch-main-uuid',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-02-15T10:00:00.000Z',
  updatedAt: '2026-02-15T10:00:00.000Z',
};

const mockDocument: Document = {
  id: 'doc-uuid-abc',
  siteId: 'site-uuid-123',
  path: 'home',
  createdAt: '2026-01-05T12:00:00.000Z',
};

const mockPublishedVersion: DocumentVersion = {
  id: 'version-uuid-001',
  documentId: 'doc-uuid-abc',
  branchId: 'branch-main-uuid',
  versionNumber: 14,
  snapshot: {
    root: { props: { title: 'Home Page' } },
    content: [{ type: 'Hero', props: { heading: 'Welcome' } }],
  },
  source: 'checkpoint',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-03-07T18:00:00.000Z',
};

const mockDraftVersion: DocumentVersion = {
  id: 'version-uuid-003',
  documentId: 'doc-uuid-abc',
  branchId: 'branch-feature-uuid',
  versionNumber: 3,
  snapshot: {
    root: { props: { title: 'Home Page (WIP)' } },
    content: [{ type: 'Hero', props: { heading: 'Work in progress' } }],
  },
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-03-08T10:00:00.000Z',
};

const mockTombstonedVersion: DocumentVersion = {
  id: 'version-uuid-002',
  documentId: 'doc-uuid-abc',
  branchId: 'branch-main-uuid',
  versionNumber: 15,
  snapshot: { _deleted: true },
  isTombstone: true,
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-03-07T19:00:00.000Z',
};

function setupSettingsMocks(settingsService: typeof import('../../src/services/site-settings-service'), ttl = 60): void {
  vi.mocked(settingsService.getSiteSettings).mockResolvedValue({
    cacheTtlMain: 120,
    cacheTtlBranch: 5,
  });
  vi.mocked(settingsService.getEffectiveCacheTtl).mockReturnValue(ttl);
}

// =============================================================================
// Tests
// =============================================================================

describe('Content Delivery API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/content/{documentPath} — Main Branch (Published)
  // ===========================================================================

  describe('GET content — main branch (published only)', () => {
    it('should use getLatestPublishedDocumentVersion for main branch', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService, 120);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getLatestPublishedDocumentVersion).toHaveBeenCalledWith('doc-uuid-abc', 'branch-main-uuid');
      expect(services.getLatestDocumentVersion).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body).toEqual({
        documentId: 'doc-uuid-abc',
        path: 'home',
        data: mockPublishedVersion.snapshot,
        branchId: 'branch-main-uuid',
        branchName: 'main',
        isMainBranch: true,
        versionNumber: 14,
        versionCreatedAt: '2026-03-07T18:00:00.000Z',
        etag: '"v-version-uuid-001"',
      });
    });

    it('should return 404 when document has saved versions but none are published on main', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      // Document has saved versions (edits) but none captured in a checkpoint
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      // Error message must not reveal that the document exists but is unpublished
      expect(body.error).toBe('Document not found');
      // Must not call getLatestDocumentVersion (which would return drafts)
      expect(services.getLatestDocumentVersion).not.toHaveBeenCalled();
    });

    it('should default to main branch when no ?branch param', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getMainBranch).toHaveBeenCalledWith('site-uuid-123');
      expect(services.getBranch).not.toHaveBeenCalled();
      const body = await response.json();
      expect(body.isMainBranch).toBe(true);
    });
  });

  // ===========================================================================
  // GET content — Non-main Branch (Work-in-Progress)
  // ===========================================================================

  describe('GET content — non-main branch (latest saved)', () => {
    it('should use getLatestDocumentVersion for non-main branches', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersion).mockResolvedValue(mockDraftVersion);
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getLatestDocumentVersion).toHaveBeenCalledWith('doc-uuid-abc', 'branch-feature-uuid');
      expect(services.getLatestPublishedDocumentVersion).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body.branchId).toBe('branch-feature-uuid');
      expect(body.branchName).toBe('feature-redesign');
      expect(body.isMainBranch).toBe(false);
      expect(body.data).toEqual(mockDraftVersion.snapshot);
    });

    it('should return 404 when no version exists on non-main branch', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersion).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should use getLatestDocumentVersionWithFallback for non-main branches', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockDraftVersion,
        inherited: false,
      });
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getLatestDocumentVersionWithFallback).toHaveBeenCalledWith(
        'doc-uuid-abc',
        'branch-feature-uuid',
        'branch-main-uuid',
      );
      expect(services.getLatestDocumentVersion).not.toHaveBeenCalled();
    });

    it('should include inherited flag in response for non-main branches (inherited=false)', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockDraftVersion,
        inherited: false,
      });
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.inherited).toBe(false);
    });

    it('should serve main published content when no local version exists (inherited)', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockPublishedVersion,
        inherited: true,
      });
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.inherited).toBe(true);
      expect(body.data).toEqual(mockPublishedVersion.snapshot);
    });

    it('should return 404 when no version on branch and no published version on main', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Shared content endpoint behavior
  // ===========================================================================

  describe('GET content — shared behavior', () => {
    it('should return 404 when document not found', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/nonexistent',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'nonexistent',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 when document is tombstoned', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockTombstonedVersion);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
    });

    it('should return 304 when If-None-Match header matches ETag', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        {
          method: 'GET',
          headers: {
            'If-None-Match': '"v-version-uuid-001"',
          },
        },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(304);
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should set Cache-Control header with TTL from site settings', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService, 120);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('s-maxage=120');
      expect(cacheControl).toContain('stale-while-revalidate=600');
    });

    it('should set ETag header on response', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('ETag')).toBe('"v-version-uuid-001"');
    });

    it('should return 404 when branch not found', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=nonexistent-branch',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/content-pages — Main Branch
  // ===========================================================================

  describe('GET content-pages — main branch (published only)', () => {
    it('should only list documents that have published versions', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const mockDocuments: Document[] = [
        { id: 'doc-uuid-abc', siteId: 'site-uuid-123', path: 'home', createdAt: '2026-01-05T12:00:00.000Z' },
        { id: 'doc-uuid-def', siteId: 'site-uuid-123', path: 'about', createdAt: '2026-01-06T12:00:00.000Z' },
        { id: 'doc-uuid-ghi', siteId: 'site-uuid-123', path: 'draft-page', createdAt: '2026-01-07T12:00:00.000Z' },
      ];

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(mockDocuments);
      // home and about have published versions; draft-page does not
      vi.mocked(services.getLatestPublishedDocumentVersion)
        .mockResolvedValueOnce({
          ...mockPublishedVersion,
          documentId: 'doc-uuid-abc',
          createdAt: '2026-03-07T18:00:00.000Z',
        })
        .mockResolvedValueOnce({
          ...mockPublishedVersion,
          id: 'version-uuid-about',
          documentId: 'doc-uuid-def',
          createdAt: '2026-03-06T12:00:00.000Z',
        })
        .mockResolvedValueOnce(null); // draft-page has no published version
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      // draft-page should be filtered out
      expect(body.pages).toHaveLength(2);
      expect(body.pages[0]).toEqual({
        path: 'home',
        documentId: 'doc-uuid-abc',
        lastModifiedAt: '2026-03-07T18:00:00.000Z',
      });
      expect(body.pages[1]).toEqual({
        path: 'about',
        documentId: 'doc-uuid-def',
        lastModifiedAt: '2026-03-06T12:00:00.000Z',
      });
      expect(body.isMainBranch).toBe(true);
      expect(services.getLatestPublishedDocumentVersion).toHaveBeenCalledTimes(3);
      expect(services.getLatestDocumentVersion).not.toHaveBeenCalled();
    });

    it('should default to main branch when no ?branch param', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue([]);
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getMainBranch).toHaveBeenCalledWith('site-uuid-123');
      expect(services.getBranch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // GET content-pages — Non-main Branch
  // ===========================================================================

  describe('GET content-pages — non-main branch (latest saved)', () => {
    it('should use getLatestDocumentVersion and include all documents with versions', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const mockDocuments: Document[] = [
        { id: 'doc-uuid-abc', siteId: 'site-uuid-123', path: 'home', createdAt: '2026-01-05T12:00:00.000Z' },
        { id: 'doc-uuid-def', siteId: 'site-uuid-123', path: 'new-page', createdAt: '2026-01-06T12:00:00.000Z' },
      ];

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(mockDocuments);
      vi.mocked(services.getLatestDocumentVersion)
        .mockResolvedValueOnce({
          ...mockDraftVersion,
          documentId: 'doc-uuid-abc',
          createdAt: '2026-03-08T10:00:00.000Z',
        })
        .mockResolvedValueOnce({
          ...mockDraftVersion,
          id: 'version-uuid-new',
          documentId: 'doc-uuid-def',
          createdAt: '2026-03-08T11:00:00.000Z',
        });
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.pages).toHaveLength(2);
      expect(body.isMainBranch).toBe(false);
      expect(services.getLatestDocumentVersion).toHaveBeenCalledTimes(2);
      expect(services.getLatestPublishedDocumentVersion).not.toHaveBeenCalled();
    });

    it('should include inherited documents from main branch', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const mockDocuments: Document[] = [
        { id: 'doc-uuid-abc', siteId: 'site-uuid-123', path: 'home', createdAt: '2026-01-05T12:00:00.000Z' },
        { id: 'doc-uuid-def', siteId: 'site-uuid-123', path: 'about', createdAt: '2026-01-06T12:00:00.000Z' },
      ];

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(mockDocuments);
      vi.mocked(services.getLatestDocumentVersion)
        .mockResolvedValueOnce(mockDraftVersion)
        .mockResolvedValueOnce({
          ...mockPublishedVersion,
          id: 'version-uuid-about',
          documentId: 'doc-uuid-def',
        });
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      // Verify listDocumentsOnBranch was called with mainBranchId option
      expect(services.listDocumentsOnBranch).toHaveBeenCalledWith(
        'branch-feature-uuid',
        expect.objectContaining({ mainBranchId: 'branch-main-uuid' }),
      );
    });

    it('should filter out documents with no versions on the branch', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const mockDocuments: Document[] = [
        { id: 'doc-uuid-abc', siteId: 'site-uuid-123', path: 'home', createdAt: '2026-01-05T12:00:00.000Z' },
        { id: 'doc-uuid-def', siteId: 'site-uuid-123', path: 'no-version', createdAt: '2026-01-06T12:00:00.000Z' },
      ];

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(mockDocuments);
      vi.mocked(services.getLatestDocumentVersion)
        .mockResolvedValueOnce(mockDraftVersion)
        .mockResolvedValueOnce(null);
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=branch-feature-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.pages).toHaveLength(1);
      expect(body.pages[0].path).toBe('home');
    });
  });

  // ===========================================================================
  // Shared content-pages behavior
  // ===========================================================================

  describe('GET content-pages — shared behavior', () => {
    it('should set Cache-Control header', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue([]);
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('s-maxage=');
    });

    it('should return 404 when branch not found', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=nonexistent-branch',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // Error Cases
  // ===========================================================================

  describe('unsupported methods', () => {
    it('should return 405 for POST', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: {} }),
        },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(405);
    });
  });
});
