/**
 * Phase 3.3: Presence Rollup Optimization Tests (TDD)
 *
 * Tests for the optimized presence rollup that queries the PresenceManager DO
 * via RPC instead of fanning out to N DocumentSession DOs.
 *
 * When the PRESENCE binding is available, getBranchPresence/getSitePresence/
 * getAgentPresence use PresenceManager DO RPC. When PRESENCE is unavailable,
 * they fall back to the existing fan-out pattern.
 *
 * queryDocumentPresence remains unchanged (direct single-document query).
 */

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActorPresence, Branch, Site } from '../../src/types';

// Mock database module
vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

// Mock services
vi.mock('../../src/services/document-service', () => ({
  listDocumentsOnBranch: vi.fn(),
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

describe('Phase 3.3: Presence Rollup Optimization (PresenceManager DO)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Helpers
  // ===========================================================================

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

  /**
   * Create a mock env with PRESENCE binding that supports RPC calls.
   * The mock stub supports direct method calls (RPC pattern).
   */
  function createPresenceEnv(rpcMethods: Record<string, ReturnType<typeof vi.fn>>) {
    const mockStub = { ...rpcMethods };
    return {
      PRESENCE: {
        idFromName: vi.fn().mockReturnValue({ name: 'mock-presence-id' }),
        get: vi.fn().mockReturnValue(mockStub),
      },
      DOCUMENT_STATE: {
        idFromName: vi.fn().mockReturnValue({ name: 'mock-doc-id' }),
        get: vi.fn().mockReturnValue({ fetch: vi.fn() }),
      },
    };
  }

  // ===========================================================================
  // getBranchPresence with PRESENCE binding
  // ===========================================================================

  describe('getBranchPresence with PRESENCE binding', () => {
    it('should query PresenceManager DO RPC instead of fan-out', async () => {
      const { getBranchPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');
      const documentService = await import('../../src/services/document-service');

      const mockBranch = createMockBranch();
      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);

      const actor1 = createMockPresence({ actorId: 'user-1', name: 'Alice' });
      const actor2 = createMockPresence({
        actorId: 'agent-1',
        actorType: 'agent',
        role: 'agent',
        name: 'Bot',
      });

      const mockEnv = createPresenceEnv({
        getBranchPresence: vi.fn().mockResolvedValue({
          actors: [actor1, actor2],
          documentSummary: [
            { documentId: 'doc-1', actorCount: 1 },
            { documentId: 'doc-2', actorCount: 1 },
          ],
        }),
      });

      const result = await getBranchPresence(mockEnv, 'site-uuid-123', 'branch-uuid-123');

      // Should use PresenceManager DO RPC
      expect(mockEnv.PRESENCE.idFromName).toHaveBeenCalledWith('site-uuid-123');
      expect(mockEnv.PRESENCE.get).toHaveBeenCalled();

      // Should NOT have queried documents (fan-out bypassed)
      expect(documentService.listDocumentsOnBranch).not.toHaveBeenCalled();

      // Results should be properly formatted
      expect(result.branchId).toBe('branch-uuid-123');
      expect(result.branchName).toBe('main');
      expect(result.siteId).toBe('site-uuid-123');
      expect(result.summary.totalActors).toBe(2);
      expect(result.summary.humanCount).toBe(1);
      expect(result.summary.agentCount).toBe(1);
      expect(result.actors).toHaveLength(2);
    });

    it('should still validate branch exists before querying presence', async () => {
      const { getBranchPresence, BranchNotFoundError } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(branchService.getBranch).mockResolvedValue(null);

      const mockEnv = createPresenceEnv({
        getBranchPresence: vi.fn(),
      });

      await expect(
        getBranchPresence(mockEnv, 'site-uuid-123', 'non-existent'),
      ).rejects.toThrow(BranchNotFoundError);

      // Should not have queried PresenceManager
      expect(mockEnv.PRESENCE.idFromName).not.toHaveBeenCalled();
    });

    it('should compute summary with editing count from RPC results', async () => {
      const { getBranchPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(branchService.getBranch).mockResolvedValue(createMockBranch());

      const editingUser = createMockPresence({
        actorId: 'user-1',
        state: 'editing',
      });
      const activeUser = createMockPresence({
        actorId: 'user-2',
        state: 'active',
      });

      const mockEnv = createPresenceEnv({
        getBranchPresence: vi.fn().mockResolvedValue({
          actors: [editingUser, activeUser],
          documentSummary: [{ documentId: 'doc-1', actorCount: 2 }],
        }),
      });

      const result = await getBranchPresence(mockEnv, 'site-uuid-123', 'branch-uuid-123');

      expect(result.summary.editingCount).toBe(1);
      expect(result.summary.totalActors).toBe(2);
    });

    it('should return document summary from RPC results', async () => {
      const { getBranchPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(branchService.getBranch).mockResolvedValue(createMockBranch());

      const mockEnv = createPresenceEnv({
        getBranchPresence: vi.fn().mockResolvedValue({
          actors: [createMockPresence({ actorId: 'user-1' })],
          documentSummary: [
            { documentId: 'doc-1', actorCount: 1 },
            { documentId: 'doc-2', actorCount: 0 },
          ],
        }),
      });

      const result = await getBranchPresence(mockEnv, 'site-uuid-123', 'branch-uuid-123');

      // Should have document summaries from the RPC response
      expect(result.documentSummary.length).toBeGreaterThanOrEqual(1);
    });

    it('should fall back to fan-out when PresenceManager RPC fails', async () => {
      const { getBranchPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');
      const documentService = await import('../../src/services/document-service');

      const mockBranch = createMockBranch();
      vi.mocked(branchService.getBranch).mockResolvedValue(mockBranch);
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([]);

      const mockEnv = createPresenceEnv({
        getBranchPresence: vi.fn().mockRejectedValue(new Error('RPC failed')),
      });

      // Should not throw - falls back to fan-out
      const result = await getBranchPresence(mockEnv, 'site-uuid-123', 'branch-uuid-123');

      // Fan-out was used (listDocumentsOnBranch called)
      expect(documentService.listDocumentsOnBranch).toHaveBeenCalled();
      expect(result.branchId).toBe('branch-uuid-123');
    });
  });

  // ===========================================================================
  // getSitePresence with PRESENCE binding
  // ===========================================================================

  describe('getSitePresence with PRESENCE binding', () => {
    it('should query PresenceManager DO RPC instead of branch fan-out', async () => {
      const { getSitePresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const siteService = await import('../../src/services/site-service');
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(siteService.getSite).mockResolvedValue(createMockSite());

      const actor1 = createMockPresence({ actorId: 'user-1', name: 'Alice' });

      const mockEnv = createPresenceEnv({
        getSitePresence: vi.fn().mockResolvedValue({
          actors: [actor1],
          branchSummary: [
            { branchId: 'branch-1', actorCount: 1 },
          ],
        }),
      });

      const result = await getSitePresence(mockEnv, 'site-uuid-123');

      // Should use PresenceManager DO RPC
      expect(mockEnv.PRESENCE.idFromName).toHaveBeenCalledWith('site-uuid-123');

      // Should NOT have listed branches (fan-out bypassed)
      expect(branchService.listBranches).not.toHaveBeenCalled();

      // Results should be properly formatted
      expect(result.siteId).toBe('site-uuid-123');
      expect(result.siteName).toBe('Test Site');
      expect(result.summary.totalActors).toBe(1);
      expect(result.summary.humanCount).toBe(1);
    });

    it('should still validate site exists before querying presence', async () => {
      const { getSitePresence, SiteNotFoundError } = await import(
        '../../src/services/presence-rollup-service'
      );
      const siteService = await import('../../src/services/site-service');

      vi.mocked(siteService.getSite).mockResolvedValue(null);

      const mockEnv = createPresenceEnv({
        getSitePresence: vi.fn(),
      });

      await expect(
        getSitePresence(mockEnv, 'non-existent'),
      ).rejects.toThrow(SiteNotFoundError);
    });

    it('should compute active branches from RPC branch summary', async () => {
      const { getSitePresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const siteService = await import('../../src/services/site-service');

      vi.mocked(siteService.getSite).mockResolvedValue(createMockSite());

      const mockEnv = createPresenceEnv({
        getSitePresence: vi.fn().mockResolvedValue({
          actors: [
            createMockPresence({ actorId: 'user-1' }),
            createMockPresence({ actorId: 'user-2' }),
          ],
          branchSummary: [
            { branchId: 'branch-1', actorCount: 1 },
            { branchId: 'branch-2', actorCount: 1 },
            { branchId: 'branch-3', actorCount: 0 },
          ],
        }),
      });

      const result = await getSitePresence(mockEnv, 'site-uuid-123');

      // 2 branches with actors > 0
      expect(result.summary.activeBranches).toBe(2);
      expect(result.summary.totalActors).toBe(2);
    });

    it('should fall back to fan-out when PresenceManager RPC fails', async () => {
      const { getSitePresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const siteService = await import('../../src/services/site-service');
      const branchService = await import('../../src/services/branch-service');

      vi.mocked(siteService.getSite).mockResolvedValue(createMockSite());
      vi.mocked(branchService.listBranches).mockResolvedValue([]);

      const mockEnv = createPresenceEnv({
        getSitePresence: vi.fn().mockRejectedValue(new Error('RPC failed')),
      });

      const result = await getSitePresence(mockEnv, 'site-uuid-123');

      // Fan-out was used (listBranches called)
      expect(branchService.listBranches).toHaveBeenCalled();
      expect(result.siteId).toBe('site-uuid-123');
    });
  });

  // ===========================================================================
  // getAgentPresence with PRESENCE binding
  // ===========================================================================

  describe('getAgentPresence with PRESENCE binding', () => {
    it('should query PresenceManager DO RPC for each site', async () => {
      const { getAgentPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const agentService = await import('../../src/services/agent-service');
      const organizationService = await import('../../src/services/organization-service');
      const branchService = await import('../../src/services/branch-service');

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

      const site1 = createMockSite({ id: 'site-1', name: 'Site 1' });
      const site2 = createMockSite({ id: 'site-2', name: 'Site 2' });
      vi.mocked(organizationService.getSitesByOrganization).mockResolvedValue([site1, site2]);

      const agentPresence = createMockPresence({
        actorId: 'agent-1',
        actorType: 'agent',
        role: 'agent',
        name: 'Test Agent',
      });

      const mockGetAgentPresence = vi.fn()
        .mockResolvedValueOnce({
          locations: [
            { branchId: 'branch-1', documentId: 'doc-1', actor: agentPresence },
          ],
        })
        .mockResolvedValueOnce({
          locations: [
            { branchId: 'branch-2', documentId: 'doc-2', actor: agentPresence },
          ],
        });

      const mockEnv = createPresenceEnv({
        getAgentPresence: mockGetAgentPresence,
      });

      const result = await getAgentPresence(mockEnv, 'org-1', 'agent-1');

      // Should NOT have listed branches (fan-out bypassed)
      expect(branchService.listBranches).not.toHaveBeenCalled();

      // Should have queried PresenceManager for each site
      expect(mockEnv.PRESENCE.idFromName).toHaveBeenCalledWith('site-1');
      expect(mockEnv.PRESENCE.idFromName).toHaveBeenCalledWith('site-2');

      expect(result.agentId).toBe('agent-1');
      expect(result.agentName).toBe('Test Agent');
      expect(result.locations).toHaveLength(2);
    });

    it('should still validate agent exists', async () => {
      const { getAgentPresence, AgentNotFoundError } = await import(
        '../../src/services/presence-rollup-service'
      );
      const agentService = await import('../../src/services/agent-service');

      vi.mocked(agentService.getAgentById).mockResolvedValue(null);

      const mockEnv = createPresenceEnv({
        getAgentPresence: vi.fn(),
      });

      await expect(
        getAgentPresence(mockEnv, 'org-1', 'non-existent'),
      ).rejects.toThrow(AgentNotFoundError);
    });

    it('should return empty locations when agent has no presence', async () => {
      const { getAgentPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const agentService = await import('../../src/services/agent-service');
      const organizationService = await import('../../src/services/organization-service');

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

      vi.mocked(organizationService.getSitesByOrganization).mockResolvedValue([
        createMockSite({ id: 'site-1' }),
      ]);

      const mockEnv = createPresenceEnv({
        getAgentPresence: vi.fn().mockResolvedValue({
          locations: [],
        }),
      });

      const result = await getAgentPresence(mockEnv, 'org-1', 'agent-1');

      expect(result.locations).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Fallback when PRESENCE is not available
  // ===========================================================================

  describe('fallback without PRESENCE binding', () => {
    it('getBranchPresence should use fan-out when PRESENCE is missing', async () => {
      const { getBranchPresence } = await import(
        '../../src/services/presence-rollup-service'
      );
      const branchService = await import('../../src/services/branch-service');
      const documentService = await import('../../src/services/document-service');

      vi.mocked(branchService.getBranch).mockResolvedValue(createMockBranch());
      vi.mocked(documentService.listDocumentsOnBranch).mockResolvedValue([]);

      // Env without PRESENCE binding
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ presences: [] }),
      });
      const envWithoutPresence = {
        DOCUMENT_STATE: {
          idFromName: vi.fn().mockReturnValue({ name: 'mock-id' }),
          get: vi.fn().mockReturnValue({ fetch: mockFetch }),
        },
      };

      const result = await getBranchPresence(
        envWithoutPresence,
        'site-uuid-123',
        'branch-uuid-123',
      );

      // Should fall back to fan-out
      expect(documentService.listDocumentsOnBranch).toHaveBeenCalled();
      expect(result.branchId).toBe('branch-uuid-123');
    });
  });
});
