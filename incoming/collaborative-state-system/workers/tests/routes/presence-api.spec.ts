/**
 * Phase 8: Presence API Routes Tests (TDD)
 *
 * Tests for REST API endpoints for presence rollup operations.
 * Based on collaborative-state-system-architecture-v2.3.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  BranchPresence,
  SitePresence,
  AgentGlobalPresence,
} from '../../src/types';

// Mock the presence rollup service
vi.mock('../../src/services/presence-rollup-service', () => ({
  getBranchPresence: vi.fn(),
  getSitePresence: vi.fn(),
  getAgentPresence: vi.fn(),
  queryDocumentPresence: vi.fn(),
  BranchNotFoundError: class BranchNotFoundError extends Error {
    name = 'BranchNotFoundError';
    constructor(public branchId: string) {
      super(`Branch with ID "${branchId}" not found.`);
    }
  },
  SiteNotFoundError: class SiteNotFoundError extends Error {
    name = 'SiteNotFoundError';
    constructor(public siteId: string) {
      super(`Site with ID "${siteId}" not found.`);
    }
  },
  AgentNotFoundError: class AgentNotFoundError extends Error {
    name = 'AgentNotFoundError';
    constructor(public agentId: string) {
      super(`Agent with ID "${agentId}" not found.`);
    }
  },
}));

// Mock the branch service for authorization checks
vi.mock('../../src/services/branch-service', () => ({
  getBranch: vi.fn().mockImplementation((branchId: string) => {
    if (branchId === 'branch-uuid-123') return Promise.resolve({ id: 'branch-uuid-123', siteId: 'site-uuid-123', name: 'main', isMain: true });
    if (branchId === 'branch-1') return Promise.resolve({ id: 'branch-1', siteId: 'site-1', name: 'main', isMain: true });
    return Promise.resolve(null);
  }),
  getMainBranch: vi.fn(),
}));

// Mock the authorization module
vi.mock('../../src/auth/authorization', () => ({
  hasPermission: vi.fn(),
}));

describe('Phase 8: Presence API Routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // Helper to create mock BranchPresence
  function createMockBranchPresence(
    overrides: Partial<BranchPresence> = {},
  ): BranchPresence {
    return {
      branchId: 'branch-uuid-123',
      branchName: 'main',
      siteId: 'site-uuid-123',
      summary: {
        totalActors: 2,
        humanCount: 1,
        agentCount: 1,
        editingCount: 1,
      },
      actors: [
        {
          id: 'presence-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Test User',
          state: 'editing',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
        {
          id: 'presence-2',
          actorId: 'agent-1',
          actorType: 'agent',
          role: 'agent',
          name: 'Test Agent',
          state: 'active',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      ],
      documentSummary: [
        {
          documentId: 'doc-1',
          documentPath: 'content/home',
          actorCount: 2,
          hasHumans: true,
          hasAgents: true,
        },
      ],
      ...overrides,
    };
  }

  // Helper to create mock SitePresence
  function createMockSitePresence(
    overrides: Partial<SitePresence> = {},
  ): SitePresence {
    return {
      siteId: 'site-uuid-123',
      siteName: 'Test Site',
      summary: {
        totalActors: 3,
        humanCount: 2,
        agentCount: 1,
        activeBranches: 2,
      },
      branches: [
        {
          branchId: 'branch-1',
          branchName: 'main',
          actorCount: 2,
          hasHumans: true,
          hasAgents: true,
        },
        {
          branchId: 'branch-2',
          branchName: 'dev',
          actorCount: 1,
          hasHumans: true,
          hasAgents: false,
        },
      ],
      ...overrides,
    };
  }

  // Helper to create mock AgentGlobalPresence
  function createMockAgentPresence(
    overrides: Partial<AgentGlobalPresence> = {},
  ): AgentGlobalPresence {
    return {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      organizationId: 'org-1',
      locations: [
        {
          siteId: 'site-1',
          siteName: 'Site 1',
          branchId: 'branch-1',
          branchName: 'main',
          documentId: 'doc-1',
          documentPath: 'content/home',
          presence: {
            id: 'presence-1',
            actorId: 'agent-1',
            actorType: 'agent',
            role: 'agent',
            name: 'Test Agent',
            state: 'active',
            lastActivityAt: new Date().toISOString(),
            joinedAt: new Date().toISOString(),
          },
        },
      ],
      ...overrides,
    };
  }

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/presence - Branch Presence
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/presence', () => {
    it('should return branch presence with correct structure', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresence = createMockBranchPresence();
      vi.mocked(presenceService.getBranchPresence).mockResolvedValueOnce(mockPresence);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/branches/branch-uuid-123/presence',
        { method: 'GET' },
      );

      // User with pantheonSiteRoles is authorized
      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          branchId: 'branch-uuid-123',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-uuid-123': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.branchId).toBe('branch-uuid-123');
      expect(body.branchName).toBe('main');
      expect(body.siteId).toBe('site-uuid-123');
      expect(body.summary.totalActors).toBe(2);
      expect(body.actors).toHaveLength(2);
      expect(body.documentSummary).toHaveLength(1);
    });

    it('should return 404 for non-existent branch', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      vi.mocked(presenceService.getBranchPresence).mockRejectedValueOnce(
        new presenceService.BranchNotFoundError('non-existent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/branches/non-existent/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          branchId: 'non-existent',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-uuid-123': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should return 405 for non-GET methods', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/branches/branch-uuid-123/presence',
        { method: 'POST' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          branchId: 'branch-uuid-123',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-uuid-123': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(405);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/presence - Site Presence
  // ===========================================================================

  describe('GET /api/sites/{siteId}/presence', () => {
    it('should return site presence with correct structure', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresence = createMockSitePresence();
      vi.mocked(presenceService.getSitePresence).mockResolvedValueOnce(mockPresence);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/presence',
        { method: 'GET' },
      );

      // User with pantheonSiteRoles is authorized
      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-uuid-123': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.siteId).toBe('site-uuid-123');
      expect(body.siteName).toBe('Test Site');
      expect(body.summary.totalActors).toBe(3);
      expect(body.summary.activeBranches).toBe(2);
      expect(body.branches).toHaveLength(2);
    });

    it('should return 404 for non-existent site', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      vi.mocked(presenceService.getSitePresence).mockRejectedValueOnce(
        new presenceService.SiteNotFoundError('non-existent'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/non-existent/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'non-existent',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'non-existent': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });
  });

  // ===========================================================================
  // GET /api/organizations/{orgId}/agents/{agentId}/presence - Agent Presence
  // ===========================================================================

  describe('GET /api/organizations/{orgId}/agents/{agentId}/presence', () => {
    it('should return agent presence with all locations', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresence = createMockAgentPresence();
      vi.mocked(presenceService.getAgentPresence).mockResolvedValueOnce(mockPresence);

      const request = new Request(
        'https://api.example.com/api/organizations/org-1/agents/agent-1/presence',
        { method: 'GET' },
      );

      // User in the same organization is authorized
      const response = await handlePresenceRoutes(
        request,
        {
          organizationId: 'org-1',
          agentId: 'agent-1',
          principal: { id: 'user-1', type: 'user', organizationId: 'org-1' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.agentId).toBe('agent-1');
      expect(body.agentName).toBe('Test Agent');
      expect(body.organizationId).toBe('org-1');
      expect(body.locations).toHaveLength(1);
      expect(body.locations[0].siteId).toBe('site-1');
    });

    it('should return 404 for non-existent agent', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      vi.mocked(presenceService.getAgentPresence).mockRejectedValueOnce(
        new presenceService.AgentNotFoundError('non-existent'),
      );

      const request = new Request(
        'https://api.example.com/api/organizations/org-1/agents/non-existent/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          organizationId: 'org-1',
          agentId: 'non-existent',
          principal: { id: 'user-1', type: 'user', organizationId: 'org-1' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should return empty locations when agent is not active anywhere', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresence = createMockAgentPresence({ locations: [] });
      vi.mocked(presenceService.getAgentPresence).mockResolvedValueOnce(mockPresence);

      const request = new Request(
        'https://api.example.com/api/organizations/org-1/agents/agent-1/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          organizationId: 'org-1',
          agentId: 'agent-1',
          principal: { id: 'user-1', type: 'user', organizationId: 'org-1' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.locations).toHaveLength(0);
    });
  });

  // ===========================================================================
  // GET /api/sites/{siteId}/branches/{branchId}/documents/{path}/presence
  // ===========================================================================

  describe('GET /api/sites/{siteId}/branches/{branchId}/documents/{path}/presence', () => {
    it('should return document presence with presences array', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresences = [
        {
          id: 'presence-1',
          actorId: 'user-1',
          actorType: 'user',
          role: 'human',
          name: 'Test User',
          state: 'editing',
          lastActivityAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
        },
      ];
      vi.mocked(presenceService.queryDocumentPresence).mockResolvedValueOnce(mockPresences);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents/home/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'home',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-1': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.presences).toHaveLength(1);
      expect(body.presences[0].actorId).toBe('user-1');
    });

    it('should return empty presences when no one is on the document', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      vi.mocked(presenceService.queryDocumentPresence).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents/home/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'home',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-1': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.presences).toHaveLength(0);
    });

    it('should decode URL-encoded document paths', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      vi.mocked(presenceService.queryDocumentPresence).mockResolvedValueOnce([]);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents/products%2Fwidgets/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'products%2Fwidgets',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-1': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
      // Verify queryDocumentPresence was called with decoded path
      expect(presenceService.queryDocumentPresence).toHaveBeenCalledWith(
        expect.anything(),
        'site-1',
        'products/widgets',
        'branch-1',
      );
    });

    it('should return 403 for document presence without permission', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const authModule = await import('../../src/auth/authorization');

      vi.mocked(authModule.hasPermission).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-1/documents/home/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-1',
          branchId: 'branch-1',
          documentPath: 'home',
          principal: { id: 'user-1', type: 'user' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Access denied');
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should return 500 on unexpected errors', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      vi.mocked(presenceService.getSitePresence).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-uuid-123': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
    });

    it('should require siteId for site/branch presence endpoints', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');

      const request = new Request(
        'https://api.example.com/api/sites/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          // siteId missing
          principal: { id: 'user-1', type: 'user' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(400);
    });
  });

  // ===========================================================================
  // Authorization
  // ===========================================================================

  describe('Authorization', () => {
    it('should return 403 for site presence without permission', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const branchService = await import('../../src/services/branch-service');
      const authModule = await import('../../src/auth/authorization');

      // Mock getMainBranch to return a branch
      vi.mocked(branchService.getMainBranch).mockResolvedValueOnce({
        id: 'main-branch-id',
        siteId: 'site-uuid-123',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Mock hasPermission to deny access
      vi.mocked(authModule.hasPermission).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/presence',
        { method: 'GET' },
      );

      // User without pantheonSiteRoles - falls back to permission check
      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          principal: { id: 'user-1', type: 'user' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Access denied');
    });

    it('should return 403 for branch presence without permission', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const authModule = await import('../../src/auth/authorization');

      // Mock hasPermission to deny access
      vi.mocked(authModule.hasPermission).mockResolvedValueOnce(false);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/branches/branch-uuid-123/presence',
        { method: 'GET' },
      );

      // User without pantheonSiteRoles - falls back to permission check
      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          branchId: 'branch-uuid-123',
          principal: { id: 'user-1', type: 'user' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Access denied');
    });

    it('should return 403 for agent presence from different organization', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');

      const request = new Request(
        'https://api.example.com/api/organizations/org-1/agents/agent-1/presence',
        { method: 'GET' },
      );

      // User in different organization
      const response = await handlePresenceRoutes(
        request,
        {
          organizationId: 'org-1',
          agentId: 'agent-1',
          principal: { id: 'user-1', type: 'user', organizationId: 'org-2' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Access denied');
    });

    it('should allow access with pantheonSiteRoles for site presence', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresence = createMockSitePresence();
      vi.mocked(presenceService.getSitePresence).mockResolvedValueOnce(mockPresence);

      const request = new Request(
        'https://api.example.com/api/sites/site-uuid-123/presence',
        { method: 'GET' },
      );

      // User with pantheonSiteRoles for the site
      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-uuid-123',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-uuid-123': 'viewer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
    });

    it('should allow agent to access its own organization presence', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');

      const mockPresence = createMockAgentPresence();
      vi.mocked(presenceService.getAgentPresence).mockResolvedValueOnce(mockPresence);

      const request = new Request(
        'https://api.example.com/api/organizations/org-1/agents/agent-1/presence',
        { method: 'GET' },
      );

      // Agent in the same organization
      const response = await handlePresenceRoutes(
        request,
        {
          organizationId: 'org-1',
          agentId: 'agent-1',
          principal: { id: 'agent-2', type: 'agent', organizationId: 'org-1' },
        },
        {} as unknown,
      );

      expect(response.status).toBe(200);
    });
  });

  // ===========================================================================
  // Cross-tenant IDOR protection
  // ===========================================================================

  describe('Cross-tenant IDOR protection', () => {
    it('rejects branch presence read when branch belongs to a different site', async () => {
      const { handlePresenceRoutes } = await import('../../src/routes/presence-api');
      const presenceService = await import('../../src/services/presence-rollup-service');
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(branchService.getBranch).mockResolvedValueOnce({
        id: 'branch-from-other-site',
        siteId: 'site-OTHER',
        name: 'main',
        isMain: true,
        status: 'active',
        createdAt: '2026-01-24T10:00:00.000Z',
        createdById: 'user-1',
        createdByType: 'user',
      } as never);

      const request = new Request(
        'https://api.example.com/api/sites/site-1/branches/branch-from-other-site/presence',
        { method: 'GET' },
      );

      const response = await handlePresenceRoutes(
        request,
        {
          siteId: 'site-1',
          branchId: 'branch-from-other-site',
          principal: {
            id: 'user-1',
            type: 'user',
            pantheonSiteRoles: { 'site-1': 'developer' },
          },
        },
        {} as unknown,
      );

      expect(response.status).toBe(404);
      expect(presenceService.getBranchPresence).not.toHaveBeenCalled();
    });
  });
});
