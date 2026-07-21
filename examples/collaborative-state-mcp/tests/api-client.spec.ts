/**
 * API Client Tests
 *
 * Tests for the Worker API HTTP client that interfaces with
 * the Collaborative State System agent politeness endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ApiClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultConfig = {
    baseUrl: 'http://localhost:8787',
    agentId: 'a0000000-0000-0000-0000-000000000001',
    agentApiKey: 'test-agent-key-zappy',
  };

  /**
   * Helper to create a mock Response object
   */
  function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
    return {
      ok,
      status,
      json: () => Promise.resolve(data),
    } as Response;
  }

  describe('constructor', () => {
    it('should create client with required config', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);
      expect(client).toBeDefined();
    });

    it('should throw if baseUrl is missing', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      expect(() => new ApiClient({ ...defaultConfig, baseUrl: '' })).toThrow();
    });

    it('should throw if agentId is missing', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      expect(() => new ApiClient({ ...defaultConfig, agentId: '' })).toThrow();
    });

    it('should throw if agentApiKey is missing', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      expect(() => new ApiClient({ ...defaultConfig, agentApiKey: '' })).toThrow();
    });
  });

  describe('listSites', () => {
    it('should list all sites accessible to the agent', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          sites: [
            {
              id: 'site-123',
              pantheonSiteId: 'pantheon-abc',
              name: 'My Site',
              createdAt: '2026-01-26T00:00:00Z',
            },
            {
              id: 'site-456',
              pantheonSiteId: 'pantheon-def',
              name: 'Other Site',
              createdAt: '2026-01-26T00:00:00Z',
            },
          ],
          total: 2,
        }),
      );

      const result = await client.listSites();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'test-agent-key-zappy',
          }) as Record<string, string>,
        }),
      );
      expect(result.sites).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should handle empty sites list', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          sites: [],
          total: 0,
        }),
      );

      const result = await client.listSites();
      expect(result.sites).toHaveLength(0);
    });
  });

  describe('listBranches', () => {
    it('should list branches for a site', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          branches: [
            {
              id: 'branch-main',
              siteId: 'site-123',
              name: 'main',
              status: 'active',
              isMain: true,
              createdAt: '2026-01-26T00:00:00Z',
            },
            {
              id: 'branch-staging',
              siteId: 'site-123',
              name: 'staging',
              status: 'active',
              isMain: false,
              createdAt: '2026-01-26T00:00:00Z',
            },
          ],
          total: 2,
        }),
      );

      const result = await client.listBranches('site-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'test-agent-key-zappy',
          }) as Record<string, string>,
        }),
      );
      expect(result.branches).toHaveLength(2);
      expect(result.branches[0]?.isMain).toBe(true);
    });

    it('should handle site not found', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Site not found' }, 404),
      );

      await expect(client.listBranches('nonexistent-site')).rejects.toThrow('Site not found');
    });
  });

  describe('createBranch', () => {
    it('sends POST to /api/sites/{siteId}/branches with name in body', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          id: 'branch-new-1',
          siteId: 'site-123',
          name: 'draft-hero',
          status: 'active',
          isMain: false,
          sourceBranchId: 'branch-main',
          sourceCheckpointId: 'cp-1',
          createdById: defaultConfig.agentId,
          createdByType: 'agent',
          createdAt: '2026-05-12T00:00:00Z',
          updatedAt: '2026-05-12T00:00:00Z',
        }, 201),
      );

      const result = await client.createBranch('site-123', { name: 'draft-hero' });

      const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
      expect(url).toBe('http://localhost:8787/api/sites/site-123/branches');
      expect(options.method).toBe('POST');
      expect(options.headers['X-API-Key']).toBe('test-agent-key-zappy');
      expect(options.headers['X-Actor-Type']).toBe('agent');
      const body = JSON.parse(options.body) as { name: string };
      expect(body.name).toBe('draft-hero');
      expect(result.id).toBe('branch-new-1');
      expect(result.name).toBe('draft-hero');
      expect(result.isMain).toBe(false);
    });

    it('includes optional description and parentBranchId in body when provided', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          id: 'b2', siteId: 'site-123', name: 'feature-x',
          description: 'PCC-1234', status: 'active', isMain: false,
          sourceBranchId: 'branch-staging',
          createdById: defaultConfig.agentId, createdByType: 'agent',
          createdAt: '', updatedAt: '',
        }, 201),
      );

      await client.createBranch('site-123', {
        name: 'feature-x',
        description: 'PCC-1234',
        parentBranchId: 'branch-staging',
      });

      const [, options] = mockFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as {
        name: string;
        description?: string;
        parentBranchId?: string;
      };
      expect(body.description).toBe('PCC-1234');
      expect(body.parentBranchId).toBe('branch-staging');
    });

    it('omits description and parentBranchId from body when not provided', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          id: 'b3', siteId: 'site-123', name: 'minimal',
          status: 'active', isMain: false,
          createdById: defaultConfig.agentId, createdByType: 'agent',
          createdAt: '', updatedAt: '',
        }, 201),
      );

      await client.createBranch('site-123', { name: 'minimal' });

      const [, options] = mockFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as Record<string, unknown>;
      expect(body).not.toHaveProperty('description');
      expect(body).not.toHaveProperty('parentBranchId');
    });

    it('surfaces 400 (missing name) as Error', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Branch name is required' }, 400),
      );

      await expect(
        client.createBranch('site-123', { name: '' }),
      ).rejects.toThrow('Branch name is required');
    });

    it('surfaces 404 (parent not found) as Error', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Parent branch not found' }, 404),
      );

      await expect(
        client.createBranch('site-123', { name: 'x', parentBranchId: 'nope' }),
      ).rejects.toThrow('Parent branch not found');
    });

    it('surfaces 409 (duplicate name) as Error', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Branch with this name already exists' }, 409),
      );

      await expect(
        client.createBranch('site-123', { name: 'main' }),
      ).rejects.toThrow('Branch with this name already exists');
    });
  });

  describe('listDocuments', () => {
    it('should list documents for a site and branch', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          documents: [
            { id: 'doc-1', path: '/home', createdAt: '2026-01-26T00:00:00Z' },
            { id: 'doc-2', path: '/about', createdAt: '2026-01-26T00:00:00Z' },
          ],
        }),
      );

      const result = await client.listDocuments('site-123', 'main');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'test-agent-key-zappy',
          }) as Record<string, string>,
        }),
      );
      expect(result.documents).toHaveLength(2);
    });

    it('should handle API errors gracefully', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Branch not found' }, 404),
      );

      await expect(client.listDocuments('site-123', 'nonexistent')).rejects.toThrow(
        'Branch not found',
      );
    });
  });

  describe('getDocument', () => {
    it('should fetch document content', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          snapshot: {
            title: 'Home Page',
            body: 'Welcome to our site.',
          },
        }),
      );

      const result = await client.getDocument('site-123', 'main', '/home');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents/%2Fhome',
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(result.snapshot.title).toBe('Home Page');
    });

    it('should handle document not found', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Document not found' }, 404),
      );

      await expect(client.getDocument('site-123', 'main', '/missing')).rejects.toThrow(
        'Document not found',
      );
    });
  });

  describe('canAgentEdit', () => {
    it('should check if agent can edit document', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          allowed: true,
        }),
      );

      const result = await client.canAgentEdit({
        siteId: 'site-123',
        branchId: 'main',
        documentPath: '/home',
        intent: 'Improving grammar',
        targetRegions: ['/content/body'],
        trigger: 'human_requested',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents/%2Fhome/can-agent-edit',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Agent-Id': 'a0000000-0000-0000-0000-000000000001',
            'X-Agent-Trigger': 'human_requested',
            'X-Agent-Intent': 'Improving grammar',
            'X-Agent-Target-Regions': '/content/body',
          }) as Record<string, string>,
        }),
      );
      expect(result.canEdit).toBe(true);
    });

    it('should return denial reason when editing not allowed', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          allowed: false,
          reason: 'active_human_collaborator',
          message: 'A human user is currently editing the document',
        }),
      );

      const result = await client.canAgentEdit({
        siteId: 'site-123',
        branchId: 'main',
        documentPath: '/home',
        intent: 'Improving grammar',
        targetRegions: ['/content/body'],
        trigger: 'human_requested',
      });

      expect(result.canEdit).toBe(false);
      expect(result.reason).toBe('active_human_collaborator');
    });
  });

  describe('startAgentEdit', () => {
    it('should start an agent edit session', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          editSessionId: 'session-uuid-123',
          checkpointId: 'checkpoint-before-123',
          expiresAt: '2026-01-26T12:05:00Z',
          reservedRegions: ['/content/body'],
        }),
      );

      const result = await client.startAgentEdit({
        siteId: 'site-123',
        branchId: 'main',
        documentPath: '/home',
        intent: 'Improving grammar',
        targetRegions: ['/content/body'],
        trigger: 'human_requested',
      });

      expect(result.editSessionId).toBe('session-uuid-123');
      expect(result.checkpointId).toBe('checkpoint-before-123');
    });

    it('should handle permission denied', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(false, { error: 'Agent is suspended', reason: 'agent_suspended' }, 403),
      );

      await expect(
        client.startAgentEdit({
          siteId: 'site-123',
          branchId: 'main',
          documentPath: '/home',
          intent: 'Improving grammar',
          targetRegions: ['/content/body'],
          trigger: 'human_requested',
        }),
      ).rejects.toThrow('Agent is suspended');
    });
  });

  describe('applyEdits', () => {
    it('should apply edit operations to document', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          success: true,
          version: 2,
        }),
      );

      const result = await client.applyEdits({
        siteId: 'site-123',
        branchId: 'main',
        documentPath: '/home',
        editSessionId: 'session-123',
        operations: [
          { type: 'replace', path: '/content/body', content: 'Improved text here.' },
        ],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents/%2Fhome/edits',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            operations: [
              { type: 'replace', path: '/content/body', content: 'Improved text here.' },
            ],
            actorId: 'a0000000-0000-0000-0000-000000000001',
            editSessionId: 'session-123',
          }),
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('completeAgentEdit', () => {
    it('should complete an agent edit session', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          success: true,
          checkpointId: 'checkpoint-after-456',
        }),
      );

      const result = await client.completeAgentEdit({
        siteId: 'site-123',
        branchId: 'main',
        documentPath: '/home',
        editSessionId: 'session-uuid-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents/%2Fhome/agent-edit-complete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Agent-Id': 'a0000000-0000-0000-0000-000000000001',
          }) as Record<string, string>,
          body: JSON.stringify({ editSessionId: 'session-uuid-123' }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe('checkpoint-after-456');
    });
  });

  describe('abortAgentEdit', () => {
    it('should abort an agent edit session', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          success: true,
          rolledBack: true,
        }),
      );

      const result = await client.abortAgentEdit({
        siteId: 'site-123',
        branchId: 'main',
        documentPath: '/home',
        editSessionId: 'session-uuid-123',
        reason: 'User cancelled the operation',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents/%2Fhome/agent-edit-abort',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            editSessionId: 'session-uuid-123',
            reason: 'User cancelled the operation',
          }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.rolledBack).toBe(true);
    });
  });

  describe('getBranchPresence', () => {
    it('should get presence information for a branch', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          siteId: 'site-123',
          branchId: 'main',
          documents: [
            {
              documentId: 'doc-123',
              documentPath: '/home',
              actors: [
                {
                  id: 'presence-1',
                  actorId: 'user-123',
                  actorType: 'user',
                  role: 'human',
                  name: 'Test User',
                  state: 'active',
                  lastActivityAt: '2026-01-27T00:00:00Z',
                  joinedAt: '2026-01-27T00:00:00Z',
                },
              ],
              actorCount: 1,
              hasActiveEditors: false,
            },
          ],
          totalActors: 1,
          totalDocuments: 1,
        }),
      );

      const result = await client.getBranchPresence('site-123', 'main');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/presence',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Actor-Id': 'a0000000-0000-0000-0000-000000000001',
            'X-Actor-Type': 'agent',
          }) as Record<string, string>,
        }),
      );
      expect(result.totalActors).toBe(1);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.documentPath).toBe('/home');
    });
  });

  describe('getDocumentPresence', () => {
    it('should get presence information for a document', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          presences: [
            {
              id: 'presence-1',
              actorId: 'user-123',
              actorType: 'user',
              role: 'human',
              name: 'Test User',
              state: 'editing',
              focusRegions: ['/content/0'],
              lastActivityAt: '2026-01-27T00:00:00Z',
              joinedAt: '2026-01-27T00:00:00Z',
            },
            {
              id: 'presence-2',
              actorId: 'a0000000-0000-0000-0000-000000000001',
              actorType: 'agent',
              role: 'agent',
              name: 'Zappy Agent',
              state: 'active',
              intent: 'Updating content',
              lastActivityAt: '2026-01-27T00:00:00Z',
              joinedAt: '2026-01-27T00:00:00Z',
            },
          ],
        }),
      );

      const result = await client.getDocumentPresence('site-123', 'main', '/home');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/main/documents/%2Fhome/presence',
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(result.presences).toHaveLength(2);
      expect(result.presences[0]?.state).toBe('editing');
      expect(result.presences[1]?.role).toBe('agent');
    });

    it('should return empty presences when no one is viewing document', async () => {
      const { ApiClient } = await import('../src/api-client.js');
      const client = new ApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          presences: [],
        }),
      );

      const result = await client.getDocumentPresence('site-123', 'main', '/about');
      expect(result.presences).toHaveLength(0);
    });
  });
});
