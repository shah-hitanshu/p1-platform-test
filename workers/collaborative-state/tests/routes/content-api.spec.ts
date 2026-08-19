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
import type { AuthenticatedPrincipal, Branch, Document, DocumentVersion, Site } from '../../src/types';
import type { SeoMetadata } from '../../src/types/page-metadata';
import { readJson } from '../helpers/http';

// Mock services
vi.mock('../../src/services', async () => {
  const actual = await vi.importActual('../../src/services');
  return {
    ...actual,
    getMainBranch: vi.fn(),
    getBranch: vi.fn(),
    getBranchByName: vi.fn(),
    getDocumentByPath: vi.fn(),
    getLatestDocumentVersion: vi.fn(),
    getLatestPublishedDocumentVersion: vi.fn(),
    getLatestDocumentVersionWithFallback: vi.fn(),
    hasTombstoneAfterVersion: vi.fn(),
    listDocumentsOnBranch: vi.fn(),
    reconstructVersionSnapshot: vi.fn(),
    buildPageMetadata: vi.fn(),
    getSite: vi.fn(),
  };
});

vi.mock('../../src/services/site-settings-service', () => ({
  getSiteSettings: vi.fn(),
  getEffectiveCacheTtl: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

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
  archivedAt: null,
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
  archivedAt: null,
};

const mockDocument: Document = {
  id: 'doc-uuid-abc',
  siteId: 'site-uuid-123',
  path: 'home',
  createdAt: '2026-01-05T12:00:00.000Z',
};

const mockSite: Site = {
  id: 'site-uuid-123',
  pantheonSiteId: 'pantheon-site-1',
  name: 'Acme Docs',
  url: 'https://content.public.url',
  workflowSettings: {
    mergeApprovalMode: 'optional',
    minApprovers: 1,
    allowSelfApproval: true,
    approverMode: 'both',
  },
  allowedOrigins: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

// The ETag covers the version and the site's last update, so a site rename
// invalidates cached payloads carrying siteName.
const mockEtag = `"v-version-uuid-001-s-${String(new Date(mockSite.updatedAt).getTime())}"`;

// buildPageMetadata is a mocked service here; its own logic is unit-tested in
// tests/services/page-metadata-service.spec.ts. This is the value it returns
// so route tests can assert the payload carries it through.
const mockMetadata: SeoMetadata = {
  siteName: 'Acme Docs',
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

const mockDiffOnlyVersion: DocumentVersion = {
  id: 'version-uuid-diff',
  documentId: 'doc-uuid-abc',
  branchId: 'branch-main-uuid',
  versionNumber: 16,
  // snapshot is undefined — this is a diff-only version
  source: 'edit',
  createdById: 'user-1',
  createdByType: 'user',
  createdAt: '2026-03-09T10:00:00.000Z',
};

const mockReconstructedSnapshot = {
  root: { props: { title: 'Reconstructed Page' } },
  content: [{ type: 'Hero', props: { heading: 'Rebuilt from diffs' } }],
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
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const services = await import('../../src/services');
    vi.mocked(services.buildPageMetadata).mockReturnValue(mockMetadata);
    vi.mocked(services.getSite).mockResolvedValue(mockSite);
    // Documents are live unless a test tombstones them [PCC-3669].
    vi.mocked(services.hasTombstoneAfterVersion).mockResolvedValue(false);
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/content/{documentPath} — Main Branch (Published)
  // ===========================================================================

  describe('GET content — main branch (published only)', () => {
    // The publish pointer survives deletion (nothing can publish a tombstone),
    // and a deletion supersedes every earlier publish [PCC-3669] — otherwise a
    // deleted page stays live forever, and a deleted-then-recreated page would
    // silently resurrect its pre-deletion published content.
    it('returns 404 when a tombstone postdates the published version', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      vi.mocked(services.hasTombstoneAfterVersion).mockResolvedValue(true);
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

      expect(response.status).toBe(404);
      const body = await readJson(response);
      expect(body.error).toContain('deleted');
      expect(services.hasTombstoneAfterVersion).toHaveBeenCalledWith(
        'doc-uuid-abc',
        'branch-main-uuid',
        mockPublishedVersion.versionNumber,
      );
      expect(services.reconstructVersionSnapshot).not.toHaveBeenCalled();
    });

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

      const body = await readJson(response);
      expect(body).toEqual({
        documentId: 'doc-uuid-abc',
        metadata: mockMetadata,
        path: 'home',
        data: mockPublishedVersion.snapshot,
        branchId: 'branch-main-uuid',
        branchName: 'main',
        isMainBranch: true,
        versionNumber: 14,
        versionCreatedAt: '2026-03-07T18:00:00.000Z',
        etag: mockEtag,
      });
      expect(services.buildPageMetadata).toHaveBeenCalledWith(mockSite, {
        cacheTtlMain: 120,
        cacheTtlBranch: 5,
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
      const body = await readJson(response);
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
      const body = await readJson(response);
      expect(body.isMainBranch).toBe(true);
    });

    it('should serve published homepage when documentPath is "/"', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const homepageDoc: Document = { ...mockDocument, path: '/' };
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(homepageDoc);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService, 120);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: '/',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getDocumentByPath).toHaveBeenCalledWith('site-uuid-123', '/');
      const body = await readJson(response);
      expect(body.path).toBe('/');
      expect(body.data).toEqual(mockPublishedVersion.snapshot);
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
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

      const body = await readJson(response);
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
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

    it('should reconstruct snapshot when version.snapshot is null (diff-only version)', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockDiffOnlyVersion);
      vi.mocked(services.reconstructVersionSnapshot).mockResolvedValue(mockReconstructedSnapshot);
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
      const body = await readJson(response);
      expect(body.data).toEqual(mockReconstructedSnapshot);
      expect(services.reconstructVersionSnapshot).toHaveBeenCalledWith(
        'doc-uuid-abc',
        'branch-main-uuid',
        16,
      );
    });

    it('should not call reconstructVersionSnapshot when version has a snapshot', async () => {
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
      const body = await readJson(response);
      expect(body.data).toEqual(mockPublishedVersion.snapshot);
      expect(services.reconstructVersionSnapshot).not.toHaveBeenCalled();
    });

    it('returns 500 without leaking version identifiers when content cannot be rebuilt', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockDiffOnlyVersion);
      vi.mocked(services.reconstructVersionSnapshot).mockRejectedValue(
        new services.VersionReconstructionError('doc-uuid-abc', 'branch-main-uuid', 16, 15),
      );
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

      expect(response.status).toBe(500);
      const body = await readJson(response);
      expect(body.error).toBe('Internal server error');
      expect(logger.error).toHaveBeenCalledTimes(1);
      const [msg, , fields] = logger.error.mock.calls[0] as [string, unknown, Record<string, unknown>];
      expect(msg).toBe('version reconstruction failed');
      expect(fields).toMatchObject({
        site_id: 'site-uuid-123',
        document_id: 'doc-uuid-abc',
        branch_id: 'branch-main-uuid',
        requested_version: 16,
        broken_version: 15,
        outcome: 'reconstruction_failed',
      });
    });

    it('should return null data when reconstruction fails for diff-only version', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockDiffOnlyVersion);
      vi.mocked(services.reconstructVersionSnapshot).mockResolvedValue(null);
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
      const body = await readJson(response);
      expect(body.data).toBeNull();
    });

    it('should reconstruct snapshot for diff-only version on non-main branch', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const featureDiffVersion: DocumentVersion = {
        ...mockDiffOnlyVersion,
        branchId: 'branch-feature-uuid',
        versionNumber: 5,
      };

      vi.mocked(services.getBranch).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: featureDiffVersion,
        inherited: false,
      });
      vi.mocked(services.reconstructVersionSnapshot).mockResolvedValue(mockReconstructedSnapshot);
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
      expect(body.data).toEqual(mockReconstructedSnapshot);
      expect(services.reconstructVersionSnapshot).toHaveBeenCalledWith(
        'doc-uuid-abc',
        'branch-feature-uuid',
        5,
      );
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
            'If-None-Match': mockEtag,
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
      expect(response.headers.get('ETag')).toBe(mockEtag);
    });

    it('should return 200 when If-None-Match matches the version but the site has since been updated', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      vi.mocked(services.getSite).mockResolvedValue({
        ...mockSite,
        name: 'Acme Docs Renamed',
        updatedAt: '2026-06-01T00:00:00.000Z',
      });
      setupSettingsMocks(settingsService);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home',
        {
          method: 'GET',
          headers: {
            'If-None-Match': mockEtag,
          },
        },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('ETag')).not.toBe(mockEtag);
    });

    it('should fall back to a version-only ETag when the site is not found', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      vi.mocked(services.getSite).mockResolvedValue(null);
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
      expect(services.buildPageMetadata).toHaveBeenCalledWith(null, {
        cacheTtlMain: 120,
        cacheTtlBranch: 5,
      });
    });

    it('should return 404 when branch not found', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=00000000-0000-0000-0000-000000000000',
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
  // Branch resolution by name
  // ===========================================================================

  describe('branch resolution by name', () => {
    it('should resolve a branch by name when ?branch is not a UUID', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranchByName).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestDocumentVersionWithFallback).mockResolvedValue({
        version: mockDraftVersion,
        inherited: false,
      });
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=feature-redesign',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getBranchByName).toHaveBeenCalledWith('site-uuid-123', 'feature-redesign');
      expect(services.getBranch).not.toHaveBeenCalled();
      const body = await readJson(response);
      expect(body.branchName).toBe('feature-redesign');
      expect(body.isMainBranch).toBe(false);
    });

    it('should resolve "main" branch name to published content', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranchByName).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService, 120);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=main',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getBranchByName).toHaveBeenCalledWith('site-uuid-123', 'main');
      expect(services.getBranch).not.toHaveBeenCalled();
      const body = await readJson(response);
      expect(body.isMainBranch).toBe(true);
    });

    it('should return 404 when branch name does not match any branch', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchByName).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=nonexistent-name',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
      expect(services.getBranchByName).toHaveBeenCalledWith('site-uuid-123', 'nonexistent-name');
      expect(services.getBranch).not.toHaveBeenCalled();
    });

    it('should still resolve branches by UUID when ?branch is a valid UUID', async () => {
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getBranch).toHaveBeenCalledWith('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(services.getBranchByName).not.toHaveBeenCalled();
    });

    it('should resolve branch name for content-pages endpoint', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getBranchByName).mockResolvedValue(mockFeatureBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue([]);
      setupSettingsMocks(settingsService, 5);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=feature-redesign',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getBranchByName).toHaveBeenCalledWith('site-uuid-123', 'feature-redesign');
      expect(services.getBranch).not.toHaveBeenCalled();
    });

    it('should default to main branch when ?branch= is empty string', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.getDocumentByPath).mockResolvedValue(mockDocument);
      vi.mocked(services.getLatestPublishedDocumentVersion).mockResolvedValue(mockPublishedVersion);
      setupSettingsMocks(settingsService, 120);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=',
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
      expect(services.getBranchByName).not.toHaveBeenCalled();
    });

    it('should resolve uppercase UUIDs via getBranch', async () => {
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
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=B2A4C6D8-E0F2-4A6B-8C0E-2A4B6C8D0E2F',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      expect(services.getBranch).toHaveBeenCalledWith('B2A4C6D8-E0F2-4A6B-8C0E-2A4B6C8D0E2F');
      expect(services.getBranchByName).not.toHaveBeenCalled();
    });

    it('should treat truncated UUID-like strings as branch names', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchByName).mockResolvedValue(null);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
      expect(services.getBranchByName).toHaveBeenCalledWith('site-uuid-123', 'b2a4c6d8-e0f2');
      expect(services.getBranch).not.toHaveBeenCalled();
    });

    it('should return 404 when UUID belongs to a branch on a different site', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      const otherSiteBranch: Branch = {
        ...mockFeatureBranch,
        siteId: 'other-site-uuid',
      };
      vi.mocked(services.getBranch).mockResolvedValue(otherSiteBranch);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
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
    // The listing must apply the same supersedes-publish rule as the
    // single-page route [PCC-3669], or it links to paths that route 404s.
    it('excludes a document whose publish is superseded by a tombstone', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const mockDocuments = [
        { id: 'doc-live', siteId: 'site-uuid-123', path: 'home', createdAt: '2026-01-05T12:00:00.000Z', inherited: false, isPublished: true },
        { id: 'doc-deleted', siteId: 'site-uuid-123', path: 'removed', createdAt: '2026-01-06T12:00:00.000Z', inherited: false, isPublished: true },
      ];

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(mockDocuments);
      vi.mocked(services.getLatestPublishedDocumentVersion)
        .mockResolvedValueOnce({ ...mockPublishedVersion, documentId: 'doc-live' })
        .mockResolvedValueOnce({ ...mockPublishedVersion, id: 'version-deleted', documentId: 'doc-deleted' });
      vi.mocked(services.hasTombstoneAfterVersion).mockImplementation(
        (documentId) => Promise.resolve(documentId === 'doc-deleted'),
      );
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
      const body = await readJson<{ pages: { documentId: string }[] }>(response);
      expect(body.pages.map((p) => p.documentId)).toEqual(['doc-live']);
    });

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
      const body = await readJson(response);
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

    it('should list root-path homepage with path "/" so listing agrees with delivery', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');
      const settingsService = await import('../../src/services/site-settings-service');

      const mockDocuments: Document[] = [
        { id: 'doc-uuid-root', siteId: 'site-uuid-123', path: '/', createdAt: '2026-01-05T12:00:00.000Z' },
        { id: 'doc-uuid-about', siteId: 'site-uuid-123', path: 'about', createdAt: '2026-01-06T12:00:00.000Z' },
      ];

      vi.mocked(services.getMainBranch).mockResolvedValue(mockMainBranch);
      vi.mocked(services.listDocumentsOnBranch).mockResolvedValue(mockDocuments);
      vi.mocked(services.getLatestPublishedDocumentVersion)
        .mockResolvedValueOnce({
          ...mockPublishedVersion,
          documentId: 'doc-uuid-root',
          createdAt: '2026-03-07T18:00:00.000Z',
        })
        .mockResolvedValueOnce({
          ...mockPublishedVersion,
          id: 'version-uuid-about',
          documentId: 'doc-uuid-about',
          createdAt: '2026-03-06T12:00:00.000Z',
        });
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
      const body = await readJson(response);
      expect(body.pages).toHaveLength(2);

      const homePage = body.pages.find((p: { path: string }) => p.path === '/');
      expect(homePage).toBeDefined();
      expect(homePage.documentId).toBe('doc-uuid-root');

      const aboutPage = body.pages.find((p: { path: string }) => p.path === 'about');
      expect(aboutPage).toBeDefined();
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
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
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
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
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
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=b2a4c6d8-e0f2-4a6b-8c0e-2a4b6c8d0e2f',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        action: 'content-pages',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(200);
      const body = await readJson(response);
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
        'https://api.example.com/api/sites/site-uuid-123/content-pages?branch=00000000-0000-0000-0000-000000000000',
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

  // ===========================================================================
  // Cross-tenant IDOR protection
  // ===========================================================================

  describe('Cross-tenant IDOR protection', () => {
    it('rejects a branch UUID belonging to a different site', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranch).mockResolvedValueOnce({
        id: 'branch-other-uuid',
        siteId: 'site-OTHER',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=branch-other-uuid',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
      expect(services.getDocumentByPath).not.toHaveBeenCalled();
    });

    it('rejects a branch name belonging to a different site', async () => {
      const { handleContentRoutes } = await import('../../src/routes/content-api');
      const services = await import('../../src/services');

      vi.mocked(services.getBranchByName).mockResolvedValueOnce({
        id: 'branch-other-uuid',
        siteId: 'site-OTHER',
        name: 'feature',
        isMain: false,
        status: 'active',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/content/home?branch=feature',
        { method: 'GET' },
      );

      const response = await handleContentRoutes(request, {
        siteId: 'site-uuid-123',
        documentPath: 'home',
        action: 'content',
        principal: mockServicePrincipal,
      });

      expect(response.status).toBe(404);
      expect(services.getDocumentByPath).not.toHaveBeenCalled();
    });
  });
});
