/**
 * Phase 8: Presence Rollup Service Tests (TDD)
 *
 * Tests for presence aggregation across documents, branches, and sites.
 * Based on collaborative-state-system-architecture-v2.3.md
 *
 * These tests are written BEFORE implementation following TDD methodology.
 */

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActorPresence, DocumentWithArchive, Branch, Site } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock the services that the presence-rollup-service will depend on
vi.mock('../../src/services/document-service', () => ({
  listDocumentsOnBranch: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByPath: vi.fn(),
}));

vi.mock('../../src/services/branch-service', () => ({
  listBranches: vi.fn(),
  getBranch: vi.fn(),
}));

vi.mock('../../src/services/site-service', () => ({
  getSite: vi.fn(),
}));

vi.mock('../../src/services/organization-service', () => ({
  getSitesByOrganization: vi.fn(),
}));

vi.mock('../../src/services/agent-service', () => ({
  getAgentById: vi.fn(),
}));

// Mock global fetch for DO requests
const mockFetch = vi.fn();

describe('Phase 8: Presence Rollup Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockReset();
  });

  /**
   * Create a mock environment with DOCUMENT_STATE binding.
   * Each test configures mockFetch to return the desired presences.
   */
  function createMockEnv(): {
    DOCUMENT_STATE: {
      idFromName: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    } {
    const mockStub = {
      fetch: mockFetch,
    };
    return {
      DOCUMENT_STATE: {
        idFromName: vi.fn().mockReturnValue({ name: 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub),
      },
    };
  }

  // Helper to create mock presence data
  function createMockPresence(overrides: Partial<ActorPresence> = {}): ActorPresence {
    return {
      id: `presence-${crypto.randomUUID()}`,
      actorId: 'user-123',
      actorType: 'user',
      role: 'human',
      name: 'Test User',
      state: 'active',
      lastActivityAt: new Date().toISOString(),
      joinedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  // Helper to create mock document
  function createMockDocument(overrides: Partial<DocumentWithArchive> = {}): DocumentWithArchive {
    return {
      id: 'doc-uuid-123',
      siteId: 'site-uuid-123',
      path: 'content/home',
      createdAt: '2026-01-26T10:00:00.000Z',
      ...overrides,
    };
  }

  // Helper to create mock branch
  function createMockBranch(overrides: Partial<Branch> = {}): Branch {
    return {
      id: 'branch-uuid-123',
      siteId: 'site-uuid-123',
      name: 'main',
      status: 'active',
      isMain: true,
      createdById: 'user-123',
      createdByType: 'user',
      createdAt: '2026-01-26T10:00:00.000Z',
      updatedAt: '2026-01-26T10:00:00.000Z',
      ...overrides,
    };
  }

  // Helper to create mock site
  function createMockSite(overrides: Partial<Site> = {}): Site {
    return {
      id: 'site-uuid-123',
      pantheonSiteId: 'pantheon-123',
      name: 'Test Site',
      workflowSettings: {
        mergeApprovalMode: 'none',
        minApprovers: 0,
        allowSelfApproval: false,
        approverMode: 'role_based',
      },
      createdAt: '2026-01-26T10:00:00.000Z',
      updatedAt: '2026-01-26T10:00:00.000Z',
      ...overrides,
    };
  }

  describe('getBranchPresence', () => {
    it('should return empty presence when no documents have actors', async () => {
      const { getBranchPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');
      const branchService = await import('../../src/services/branch-service');

      const mockBranch = createMockBranch();
      const mockDoc = createMockDocument();
      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([mockDoc]);
      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(mockDoc);

      // Mock DO fetch returning empty presences
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [] }),
      });

      const result = await getBranchPresence(
        createMockEnv(),
        'site-uuid-123',
        'branch-uuid-123',
      );

      expect(result.branchId).toBe('branch-uuid-123');
      expect(result.branchName).toBe('main');
      expect(result.siteId).toBe('site-uuid-123');
      expect(result.summary.totalActors).toBe(0);
      expect(result.summary.humanCount).toBe(0);
      expect(result.summary.agentCount).toBe(0);
      expect(result.summary.editingCount).toBe(0);
      expect(result.actors).toHaveLength(0);
      expect(result.documentSummary).toHaveLength(0);
    });

    it('should aggregate presence from a single document', async () => {
      const { getBranchPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');
      const branchService = await import('../../src/services/branch-service');

      const mockBranch = createMockBranch();
      const mockDoc = createMockDocument({ id: 'doc-1', path: 'content/home' });

      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([mockDoc]);
      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(mockDoc);

      const mockPresence = createMockPresence({ actorId: 'user-1', name: 'Alice' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [mockPresence] }),
      });

      const result = await getBranchPresence(
        createMockEnv(),
        'site-uuid-123',
        'branch-uuid-123',
      );

      expect(result.summary.totalActors).toBe(1);
      expect(result.summary.humanCount).toBe(1);
      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].actorId).toBe('user-1');
      expect(result.documentSummary).toHaveLength(1);
      expect(result.documentSummary[0].documentId).toBe('doc-1');
      expect(result.documentSummary[0].hasHumans).toBe(true);
    });

    it('should aggregate presence across multiple documents', async () => {
      const { getBranchPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');
      const branchService = await import('../../src/services/branch-service');

      const mockBranch = createMockBranch();
      const mockDoc1 = createMockDocument({ id: 'doc-1', path: 'content/home' });
      const mockDoc2 = createMockDocument({ id: 'doc-2', path: 'content/about' });

      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([mockDoc1, mockDoc2]);
      vi.mocked(documentService.getDocumentByPath).mockImplementation((_, path) =>
        Promise.resolve(path === 'content/home' ? mockDoc1 : mockDoc2),
      );

      // Different presence for each document
      const presence1 = createMockPresence({ actorId: 'user-1', name: 'Alice' });
      const presence2 = createMockPresence({
        actorId: 'agent-1',
        actorType: 'agent',
        role: 'agent',
        name: 'Bot',
      });

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        const presences = callCount === 1 ? [presence1] : [presence2];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ presences }),
        });
      });

      const result = await getBranchPresence(
        createMockEnv(),
        'site-uuid-123',
        'branch-uuid-123',
      );

      expect(result.summary.totalActors).toBe(2);
      expect(result.summary.humanCount).toBe(1);
      expect(result.summary.agentCount).toBe(1);
      expect(result.actors).toHaveLength(2);
      expect(result.documentSummary).toHaveLength(2);
    });

    it('should deduplicate actors present in multiple documents', async () => {
      const { getBranchPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');
      const branchService = await import('../../src/services/branch-service');

      const mockBranch = createMockBranch();
      const mockDoc1 = createMockDocument({ id: 'doc-1', path: 'content/page-1' });
      const mockDoc2 = createMockDocument({ id: 'doc-2', path: 'content/page-2' });

      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([mockDoc1, mockDoc2]);
      vi.mocked(documentService.getDocumentByPath).mockImplementation((_, path) =>
        Promise.resolve(path === 'content/page-1' ? mockDoc1 : mockDoc2),
      );

      // Same user in both documents
      const sameUser = createMockPresence({ actorId: 'user-1', name: 'Alice' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [sameUser] }),
      });

      const result = await getBranchPresence(
        createMockEnv(),
        'site-uuid-123',
        'branch-uuid-123',
      );

      // Should deduplicate - only 1 unique actor
      expect(result.summary.totalActors).toBe(1);
      expect(result.actors).toHaveLength(1);
      // But document summary should show both documents have presence
      expect(result.documentSummary).toHaveLength(2);
    });

    it('should correctly count actors in editing state', async () => {
      const { getBranchPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');
      const branchService = await import('../../src/services/branch-service');

      const mockBranch = createMockBranch();
      const mockDoc = createMockDocument();

      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([mockDoc]);
      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(mockDoc);

      const editingUser = createMockPresence({ actorId: 'user-1', state: 'editing' });
      const idleUser = createMockPresence({ actorId: 'user-2', state: 'idle' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [editingUser, idleUser] }),
      });

      const result = await getBranchPresence(
        createMockEnv(),
        'site-uuid-123',
        'branch-uuid-123',
      );

      expect(result.summary.editingCount).toBe(1);
    });

    it('should handle DO query failures gracefully', async () => {
      const { getBranchPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');
      const branchService = await import('../../src/services/branch-service');

      const mockBranch = createMockBranch();
      const mockDoc = createMockDocument();

      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([mockDoc]);
      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(mockDoc);

      // Mock DO fetch failure
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      });

      const result = await getBranchPresence(
        createMockEnv(),
        'site-uuid-123',
        'branch-uuid-123',
      );

      // Should return empty results but not throw
      expect(result.summary.totalActors).toBe(0);
      expect(result.actors).toHaveLength(0);
    });

    it('should throw BranchNotFoundError for non-existent branch', async () => {
      const { getBranchPresence, BranchNotFoundError } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(branchService.getBranch).mockResolvedValue(null);

      await expect(
        getBranchPresence(createMockEnv(), 'site-uuid-123', 'non-existent'),
      ).rejects.toThrow(BranchNotFoundError);
    });
  });

  describe('getSitePresence', () => {
    it('should return empty presence when site has no active branches', async () => {
      const { getSitePresence } = await import('../../src/services/presence-rollup-service');
      const siteService = await import('../../src/services/site-service');
      const branchService = await import('../../src/services/branch-service');

      const mockSite = createMockSite();
      vi.mocked(siteService.getSite).mockResolvedValue(mockSite);
      vi.mocked(branchService.listBranches).mockResolvedValue([]);

      const result = await getSitePresence(createMockEnv(), 'site-uuid-123');

      expect(result.siteId).toBe('site-uuid-123');
      expect(result.siteName).toBe('Test Site');
      expect(result.summary.totalActors).toBe(0);
      expect(result.summary.activeBranches).toBe(0);
      expect(result.branches).toHaveLength(0);
    });

    it('should aggregate presence across multiple branches', async () => {
      const { getSitePresence } = await import('../../src/services/presence-rollup-service');
      const siteService = await import('../../src/services/site-service');
      const branchService = await import('../../src/services/branch-service');
      const documentService = await import('../../src/services/document-service');

      const mockSite = createMockSite();
      const mainBranch = createMockBranch({ id: 'branch-main', name: 'main' });
      const devBranch = createMockBranch({ id: 'branch-dev', name: 'dev', isMain: false });

      vi.mocked(siteService.getSite).mockResolvedValue(mockSite);
      vi.mocked(branchService.listBranches).mockResolvedValue([mainBranch, devBranch]);
      vi.mocked(branchService.getBranch).mockImplementation((id: string) => {
        return Promise.resolve(id === 'branch-main' ? mainBranch : devBranch);
      });
      const sharedDoc = createMockDocument();
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([sharedDoc]);
      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(sharedDoc);

      const humanPresence = createMockPresence({ actorId: 'user-1' });
      const agentPresence = createMockPresence({
        actorId: 'agent-1',
        actorType: 'agent',
        role: 'agent',
      });

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        const presences = callCount === 1 ? [humanPresence] : [agentPresence];
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ presences }),
        });
      });

      const result = await getSitePresence(createMockEnv(), 'site-uuid-123');

      expect(result.summary.totalActors).toBe(2);
      expect(result.summary.humanCount).toBe(1);
      expect(result.summary.agentCount).toBe(1);
      expect(result.summary.activeBranches).toBe(2);
      expect(result.branches).toHaveLength(2);
    });

    it('should throw SiteNotFoundError for non-existent site', async () => {
      const { getSitePresence, SiteNotFoundError } = await import(
        '../../src/services/presence-rollup-service'
      );
      const siteService = await import('../../src/services/site-service');

      vi.mocked(siteService.getSite).mockResolvedValue(null);

      await expect(getSitePresence(createMockEnv(), 'non-existent')).rejects.toThrow(
        SiteNotFoundError,
      );
    });
  });

  describe('getAgentPresence', () => {
    it('should return empty locations when agent is not active anywhere', async () => {
      const { getAgentPresence } = await import('../../src/services/presence-rollup-service');
      const agentService = await import('../../src/services/agent-service');
      const organizationService = await import('../../src/services/organization-service');
      const branchService = await import('../../src/services/branch-service');
      const documentService = await import('../../src/services/document-service');
      const siteService = await import('../../src/services/site-service');

      vi.mocked(agentService.getAgentById).mockResolvedValue({
        id: 'agent-1',
        organizationId: 'org-1',
        name: 'Test Agent',
        capabilities: ['edit'],
        status: 'active',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      vi.mocked(organizationService.getSitesByOrganization).mockResolvedValue([createMockSite()]);
      vi.mocked(branchService.listBranches).mockResolvedValue([createMockBranch()]);
      vi.mocked(branchService.getBranch).mockResolvedValue(createMockBranch());
      vi.mocked(siteService.getSite).mockResolvedValue(createMockSite());
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([createMockDocument()]);

      // No presence for the agent
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [] }),
      });

      const result = await getAgentPresence(createMockEnv(), 'org-1', 'agent-1');

      expect(result.agentId).toBe('agent-1');
      expect(result.agentName).toBe('Test Agent');
      expect(result.organizationId).toBe('org-1');
      expect(result.locations).toHaveLength(0);
    });

    it('should find agent presence across multiple sites', async () => {
      const { getAgentPresence } = await import('../../src/services/presence-rollup-service');
      const agentService = await import('../../src/services/agent-service');
      const organizationService = await import('../../src/services/organization-service');
      const branchService = await import('../../src/services/branch-service');
      const documentService = await import('../../src/services/document-service');
      const siteService = await import('../../src/services/site-service');

      const site1 = createMockSite({ id: 'site-1', name: 'Site 1' });
      const site2 = createMockSite({ id: 'site-2', name: 'Site 2' });
      const branch1 = createMockBranch({ id: 'branch-1', siteId: 'site-1' });
      const branch2 = createMockBranch({ id: 'branch-2', siteId: 'site-2' });
      const doc1 = createMockDocument({ id: 'doc-1', siteId: 'site-1', path: 'content/home' });
      const doc2 = createMockDocument({ id: 'doc-2', siteId: 'site-2', path: 'content/about' });

      vi.mocked(agentService.getAgentById).mockResolvedValue({
        id: 'agent-1',
        organizationId: 'org-1',
        name: 'Test Agent',
        capabilities: ['edit'],
        status: 'active',
        settings: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      vi.mocked(organizationService.getSitesByOrganization).mockResolvedValue([site1, site2]);
      vi.mocked(branchService.listBranches).mockImplementation((siteId: string) => {
        return Promise.resolve(siteId === 'site-1' ? [branch1] : [branch2]);
      });
      vi.mocked(branchService.getBranch).mockImplementation((id: string) => {
        return Promise.resolve(id === 'branch-1' ? branch1 : branch2);
      });
      vi.mocked(siteService.getSite).mockImplementation((id: string) => {
        return Promise.resolve(id === 'site-1' ? site1 : site2);
      });
      vi.mocked(documentService.listDocumentsOnBranch).mockImplementation((branchId: string) => {
        return Promise.resolve(branchId === 'branch-1' ? [doc1] : [doc2]);
      });
      vi.mocked(documentService.getDocumentByPath).mockImplementation((_, path) =>
        Promise.resolve(path === doc1.path ? doc1 : doc2),
      );

      // Agent present in both sites
      const agentPresence = createMockPresence({
        actorId: 'agent-1',
        actorType: 'agent',
        role: 'agent',
        name: 'Test Agent',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [agentPresence] }),
      });

      const result = await getAgentPresence(createMockEnv(), 'org-1', 'agent-1');

      expect(result.locations.length).toBeGreaterThanOrEqual(1);
      expect(result.locations[0].presence.actorId).toBe('agent-1');
    });

    it('should throw AgentNotFoundError for non-existent agent', async () => {
      const { getAgentPresence, AgentNotFoundError } = await import(
        '../../src/services/presence-rollup-service'
      );
      const agentService = await import('../../src/services/agent-service');

      vi.mocked(agentService.getAgentById).mockResolvedValue(null);

      await expect(getAgentPresence(createMockEnv(), 'org-1', 'non-existent')).rejects.toThrow(
        AgentNotFoundError,
      );
    });
  });

  describe('queryDocumentPresence', () => {
    const SITE_ID = 'site-uuid-123';
    const BRANCH_ID = 'branch-uuid-123';
    const DOC_PATH = 'content/home';
    const DOC_UUID = 'actual-doc-uuid-456';

    interface MockDocEnv {
      DOCUMENT_STATE: {
        idFromName: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
      };
    }

    function createMockDocEnv(): MockDocEnv {
      return {
        DOCUMENT_STATE: {
          idFromName: vi.fn().mockReturnValue({ name: 'mock-id' }),
          get: vi.fn().mockReturnValue({ fetch: mockFetch }),
        },
      };
    }

    it('should use document UUID (not path) to key the DocumentSession DO', async () => {
      const { queryDocumentPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(
        createMockDocument({ id: DOC_UUID, siteId: SITE_ID, path: DOC_PATH }),
      );
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [] }),
      });

      const mockEnv = createMockDocEnv();
      await queryDocumentPresence(mockEnv as unknown, SITE_ID, DOC_PATH, BRANCH_ID);

      // The session key passed to idFromName must use the UUID, not the raw path string
      expect(mockEnv.DOCUMENT_STATE.idFromName).toHaveBeenCalledWith(
        `${SITE_ID}:${DOC_UUID}:${BRANCH_ID}`,
      );
      expect(documentService.getDocumentByPath).toHaveBeenCalledWith(SITE_ID, DOC_PATH);
    });

    it('should return [] and skip DO when document path is not found', async () => {
      const { queryDocumentPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(null);

      const mockEnv = createMockDocEnv();
      const result = await queryDocumentPresence(
        mockEnv as unknown,
        SITE_ID,
        'nonexistent/path',
        BRANCH_ID,
      );

      expect(result).toHaveLength(0);
      expect(mockEnv.DOCUMENT_STATE.idFromName).not.toHaveBeenCalled();
      expect(mockEnv.DOCUMENT_STATE.get).not.toHaveBeenCalled();
    });

    it('should query presence from a single document DO', async () => {
      const { queryDocumentPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(
        createMockDocument({ id: DOC_UUID, siteId: SITE_ID, path: DOC_PATH }),
      );
      const mockPresence = createMockPresence();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [mockPresence] }),
      });

      const mockEnv = createMockDocEnv();
      const result = await queryDocumentPresence(
        mockEnv as unknown,
        SITE_ID,
        DOC_PATH,
        BRANCH_ID,
      );

      expect(result).toHaveLength(1);
      expect(result[0].actorId).toBe('user-123');
    });

    it('should return empty array when DO fetch fails', async () => {
      const { queryDocumentPresence } = await import('../../src/services/presence-rollup-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(documentService.getDocumentByPath).mockResolvedValue(
        createMockDocument({ id: DOC_UUID, siteId: SITE_ID, path: DOC_PATH }),
      );
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const mockEnv = createMockDocEnv();
      const result = await queryDocumentPresence(
        mockEnv as unknown,
        SITE_ID,
        DOC_PATH,
        BRANCH_ID,
      );

      expect(result).toHaveLength(0);
    });
  });
});
