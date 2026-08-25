/**
 * McpApiClient Tests
 *
 * Tests for the Worker API HTTP client with acting-user header support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('McpApiClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultConfig = {
    baseUrl: 'http://localhost:8787',
    agentId: 'agent-uuid-1',
    agentApiKey: 'aak_test-key',
  };

  function createMockResponse(ok: boolean, data: unknown, status = 200): Response {
    return {
      ok,
      status,
      json: () => Promise.resolve(data),
    } as Response;
  }

  describe('constructor', () => {
    it('should create client with required config', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);
      expect(client).toBeDefined();
    });

    it('should throw if baseUrl is missing', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      expect(() => new McpApiClient({ ...defaultConfig, baseUrl: '' })).toThrow();
    });

    it('should throw if neither agentApiKey nor accessToken is provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      expect(() => new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-uuid-1',
      })).toThrow('either agentApiKey or accessToken');
    });

    it('should NOT throw if only accessToken is provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      expect(() => new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-uuid-1',
        accessToken: 'auth0-token-xyz',
      })).not.toThrow();
    });
  });

  // Test 2: Agent authentication headers
  describe('headers', () => {
    it('should include agent auth headers on all requests', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-API-Key']).toBe('aak_test-key');
      expect(options.headers['X-Actor-Type']).toBe('agent');
      expect(options.headers['X-Actor-Id']).toBe('agent-uuid-1');
    });

    // Agent pass-through: the caller's key is forwarded and no actor id is
    // fabricated; the backend derives the agent identity from the key.
    it('forwards the caller key with no fabricated actor id when agentId is absent', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentApiKey: 'aak_caller',
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-API-Key']).toBe('aak_caller');
      expect(options.headers['X-Actor-Type']).toBe('agent');
      expect(options.headers['X-Actor-Id']).toBeUndefined();
      expect(options.headers.Authorization).toBeUndefined();
    });

    // Test 3: Acting-user headers when actingUser is set
    it('should include acting-user headers when actingUser is set', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        ...defaultConfig,
        actingUser: { id: 'user-123', email: 'user@example.com' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Id']).toBe('user-123');
      expect(options.headers['X-Acting-User-Email']).toBe('user@example.com');
    });

    // Test 4: Acting-user headers absent when actingUser not set
    it('should NOT include acting-user headers when actingUser is absent', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Id']).toBeUndefined();
      expect(options.headers['X-Acting-User-Email']).toBeUndefined();
    });

    // PCC-3191: Bearer token tests
    it('should send Authorization: Bearer when accessToken is provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-uuid-1',
        accessToken: 'auth0-access-token-xyz',
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe('Bearer auth0-access-token-xyz');
      expect(options.headers['X-API-Key']).toBeUndefined();
    });

    // The human (OAuth) path authenticates as a user: the actor type is 'user'
    // and no agent actor id is fabricated, so the backend resolves the signed-in
    // user from the bearer token alone.
    it('signals X-Actor-Type: user and sends no X-Actor-Id on the human path', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        baseUrl: 'http://localhost:8787',
        accessToken: 'auth0-access-token-xyz',
        actingUser: { id: 'user-123', email: 'user@example.com' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Actor-Type']).toBe('user');
      expect(options.headers['X-Actor-Id']).toBeUndefined();
      expect(options.headers.Authorization).toBe('Bearer auth0-access-token-xyz');
    });

    it('should not send X-Acting-User-Id/Email headers when using accessToken auth', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-uuid-1',
        accessToken: 'auth0-access-token-xyz',
        actingUser: { id: 'user-123', email: 'user@example.com' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Id']).toBeUndefined();
      expect(options.headers['X-Acting-User-Email']).toBeUndefined();
    });

    it('agentApiKey path still sends X-API-Key and X-Acting-User-* (legacy local dev)', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-uuid-1',
        agentApiKey: 'aak_test-key',
        actingUser: { id: 'user-123', email: 'user@example.com' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-API-Key']).toBe('aak_test-key');
      expect(options.headers['X-Acting-User-Id']).toBe('user-123');
      expect(options.headers['X-Acting-User-Email']).toBe('user@example.com');
      expect(options.headers.Authorization).toBeUndefined();
    });

    // PCC-3200: X-Acting-User-Name tests (forwarded on BOTH auth paths)
    it('should include X-Acting-User-Name header when actingUser.name is defined', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        ...defaultConfig,
        actingUser: { id: 'user-123', email: 'user@example.com', name: 'Alice Smith' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Name']).toBe('Alice Smith');
    });

    it('should include X-Acting-User-Name on Bearer path when name is defined', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        baseUrl: 'http://localhost:8787',
        agentId: 'agent-uuid-1',
        accessToken: 'auth0-access-token-xyz',
        actingUser: { id: 'user-123', email: 'user@example.com', name: 'Alice Smith' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Name']).toBe('Alice Smith');
      expect(options.headers.Authorization).toBe('Bearer auth0-access-token-xyz');
    });

    it('should NOT include X-Acting-User-Name header when actingUser.name is undefined', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        ...defaultConfig,
        actingUser: { id: 'user-123', email: 'user@example.com' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Name']).toBeUndefined();
    });

    it('should NOT include X-Acting-User-Name header when actingUser is absent', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Acting-User-Name']).toBeUndefined();
    });
  });

  // Test 5: listSites URL and method
  describe('listSites', () => {
    it('should send GET to /api/sites', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // Test 6: listBranches URL with site ID
  describe('listBranches', () => {
    it('should send GET to /api/sites/{siteId}/branches', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { branches: [], total: 0 }));
      await client.listBranches('site-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // Test 7: listDocuments URL with site and branch IDs
  describe('listDocuments', () => {
    it('should send GET to /api/sites/{siteId}/branches/{branchId}/documents', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));
      await client.listDocuments('site-123', 'branch-456');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/branch-456/documents',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // Test 8: getDocument URL-encodes path
  describe('getDocument', () => {
    it('should URL-encode document path', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { snapshot: {} }));
      await client.getDocument('site-123', 'branch-456', '/home');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('%2Fhome');
    });
  });

  describe('lookupDocumentByPath', () => {
    it('returns null when no document exists at the path', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Document not found at path' }), { status: 404 }),
      );

      await expect(client.lookupDocumentByPath('site-123', 'new-page')).resolves.toBeNull();
    });

    it('still throws when the lookup is refused', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      );

      await expect(client.lookupDocumentByPath('site-123', 'index')).rejects.toThrow('Forbidden');
    });
  });

  // Test 9: canAgentEdit sends POST with agent context
  describe('canAgentEdit', () => {
    it('should send POST with agent context headers and body', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { allowed: true }));
      await client.canAgentEdit({
        siteId: 'site-1',
        branchId: 'branch-1',
        documentPath: '/home',
        intent: 'Updating content',
        targetRegions: ['/content/body'],
        trigger: 'autonomous',
      });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/can-agent-edit');
      expect(options.method).toBe('POST');
      // Identity is derived from the credential; no X-Agent-Id or body agentId is sent.
      expect(options.headers['X-Agent-Id']).toBeUndefined();
      expect(JSON.parse(options.body).agentId).toBeUndefined();
      expect(options.headers['X-Agent-Trigger']).toBe('autonomous');
    });
  });

  // Test 10: startAgentEdit
  describe('startAgentEdit', () => {
    it('should return session info', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        editSessionId: 'sess-1',
        checkpointId: 'cp-1',
        expiresAt: '2026-01-01T00:00:00Z',
        reservedRegions: ['/content'],
      }));

      const result = await client.startAgentEdit({
        siteId: 's1',
        branchId: 'b1',
        documentPath: '/home',
        intent: 'test',
        targetRegions: ['/content'],
        trigger: 'autonomous',
      });

      expect(result.editSessionId).toBe('sess-1');
      expect(result.checkpointId).toBe('cp-1');
    });
  });

  // Test 11: applyEdits
  describe('applyEdits', () => {
    it('should send operations with editSessionId', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, version: 2 }));
      await client.applyEdits({
        siteId: 's1',
        branchId: 'b1',
        documentPath: '/home',
        editSessionId: 'sess-1',
        operations: [{ type: 'replace', path: '/content/body', content: 'New text' }],
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.editSessionId).toBe('sess-1');
      expect(body.operations).toHaveLength(1);
    });

    // The backend resolves the actor from the verified principal, so the client
    // forwards no actor id of its own.
    it('does not send a fabricated actorId in the apply body', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { success: true, version: 2 }));
      await client.applyEdits({
        siteId: 's1',
        branchId: 'b1',
        documentPath: '/home',
        editSessionId: 'sess-1',
        operations: [{ type: 'replace', path: '/content/body', content: 'x' }],
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.actorId).toBeUndefined();
    });
  });

  // Test 12: completeAgentEdit
  describe('completeAgentEdit', () => {
    it('should send editSessionId and return checkpointId', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        success: true,
        checkpointId: 'cp-after-1',
      }));

      const result = await client.completeAgentEdit({
        siteId: 's1',
        branchId: 'b1',
        documentPath: '/home',
        editSessionId: 'sess-1',
      });

      const [, options] = mockFetch.mock.calls[0];
      // Identity is derived from the credential; no X-Agent-Id is sent.
      expect(options.headers['X-Agent-Id']).toBeUndefined();
      expect(result.checkpointId).toBe('cp-after-1');
    });
  });

  // Test 13: abortAgentEdit
  describe('abortAgentEdit', () => {
    it('should send editSessionId and optional reason', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        success: true,
        rolledBack: true,
      }));

      const result = await client.abortAgentEdit({
        siteId: 's1',
        branchId: 'b1',
        documentPath: '/home',
        editSessionId: 'sess-1',
        reason: 'cancelled',
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.editSessionId).toBe('sess-1');
      expect(body.reason).toBe('cancelled');
      expect(result.rolledBack).toBe(true);
    });
  });

  // Test 14: getBranchPresence
  describe('getBranchPresence', () => {
    it('should send GET to presence endpoint', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        siteId: 's1', branchId: 'b1', documents: [], totalActors: 0, totalDocuments: 0,
      }));
      await client.getBranchPresence('site-123', 'branch-456');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/sites/site-123/branches/branch-456/presence',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // Test 15: getDocumentPresence
  describe('getDocumentPresence', () => {
    it('should send GET with encoded document path', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { presences: [] }));
      await client.getDocumentPresence('site-123', 'branch-456', '/home');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('%2Fhome/presence');
    });
  });

  // Test 16: Error handling
  describe('error handling', () => {
    it('should throw with error message on non-200 response', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(false, { error: 'Not found' }, 404));

      await expect(client.listSites()).rejects.toThrow('Not found');
    });
  });

  // Test 17: Trailing slash stripped from baseUrl
  describe('baseUrl normalization', () => {
    it('should strip trailing slash from baseUrl', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({ ...defaultConfig, baseUrl: 'http://localhost:8787/' });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { sites: [], total: 0 }));
      await client.listSites();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8787/api/sites');
    });
  });

  // Tests for listDocuments with pathPrefix
  describe('listDocuments with pathPrefix', () => {
    it('appends pathPrefix as a query parameter when provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

      await client.listDocuments('site-1', 'branch-1', { pathPrefix: '/_registry/components/' });

      const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
      expect(url).toContain('pathPrefix=%2F_registry%2Fcomponents%2F');
    });

    it('does not append query params when pathPrefix is not provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, { documents: [] }));

      await client.listDocuments('site-1', 'branch-1');

      const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
      expect(url).not.toContain('pathPrefix');
    });
  });

  // Tests for getDocumentLatestVersion
  describe('getDocumentLatestVersion', () => {
    it('fetches the latest version snapshot by document ID', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        id: 'ver-1',
        documentId: 'doc-abc123',
        versionNumber: 1,
        snapshot: { name: 'HeroBlock', descriptorHash: 'abc' },
      }));

      const result = await client.getDocumentLatestVersion('site-1', 'branch-1', 'doc-abc123');

      const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
      // URL must use documentId directly — not an encoded path
      expect(url).toContain('/documents/doc-abc123/versions/latest');
      expect(url).not.toContain('%2F'); // no path encoding — it is a UUID segment
      expect(result.snapshot).toEqual({ name: 'HeroBlock', descriptorHash: 'abc' });
      expect(result.id).toBe('ver-1');
    });
  });

  // Registry casing regression (PCC-3437 follow-up): registry document paths
  // are lowercased server-side (normalizePath), so the path-derived name
  // ("leadcapture") no longer matches the component's real, original-case
  // name. fetchRegistrySchemas must key/report by the descriptor snapshot's
  // own preserved-case `name` field instead.
  describe('fetchRegistrySchemas', () => {
    it('keys the returned schemas case-insensitively and preserves the descriptor\'s original-case name', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        documents: [
          { id: 'doc-lc', path: '/_registry/components/leadcapture', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        ],
      }));
      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        id: 'ver-1',
        documentId: 'doc-lc',
        versionNumber: 1,
        snapshot: { name: 'LeadCapture', defaultProps: { headline: '' } },
      }));

      const schemas = await client.fetchRegistrySchemas('site-1', 'branch-1');

      // The map key is normalized to lowercase for case-insensitive lookup...
      expect(schemas.leadcapture).toBeDefined();
      expect(schemas.LeadCapture).toBeUndefined();
      // ...while the schema's own `name` field preserves the real casing for display.
      expect(schemas.leadcapture.name).toBe('LeadCapture');
    });
  });

  // Tests for createBranch
  describe('createBranch', () => {
    it('sends POST to /api/sites/{siteId}/branches with name in body', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        id: 'branch-new-1',
        siteId: 'site-1',
        name: 'draft-hero',
        status: 'active',
        isMain: false,
        sourceBranchId: 'branch-main',
        sourceCheckpointId: 'cp-1',
        createdById: 'agent-uuid-1',
        createdByType: 'agent',
        createdAt: '2026-05-12T00:00:00Z',
        updatedAt: '2026-05-12T00:00:00Z',
      }, 201));

      const result = await client.createBranch('site-1', { name: 'draft-hero' });

      const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('http://localhost:8787/api/sites/site-1/branches');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body) as { name: string };
      expect(body.name).toBe('draft-hero');
      expect(result.id).toBe('branch-new-1');
      expect(result.name).toBe('draft-hero');
      expect(result.isMain).toBe(false);
      expect(result.sourceBranchId).toBe('branch-main');
    });

    it('includes optional description and parentBranchId in body when provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        id: 'branch-new-2',
        siteId: 'site-1',
        name: 'feature-x',
        description: 'PCC-1234: hero rewrite',
        status: 'active',
        isMain: false,
        sourceBranchId: 'branch-staging',
        createdById: 'agent-uuid-1',
        createdByType: 'agent',
        createdAt: '2026-05-12T00:00:00Z',
        updatedAt: '2026-05-12T00:00:00Z',
      }, 201));

      await client.createBranch('site-1', {
        name: 'feature-x',
        description: 'PCC-1234: hero rewrite',
        parentBranchId: 'branch-staging',
      });

      const [, options] = mockFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as {
        name: string;
        description?: string;
        parentBranchId?: string;
      };
      expect(body.name).toBe('feature-x');
      expect(body.description).toBe('PCC-1234: hero rewrite');
      expect(body.parentBranchId).toBe('branch-staging');
    });

    it('omits description and parentBranchId from body when not provided', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        id: 'branch-new-3',
        siteId: 'site-1',
        name: 'minimal',
        status: 'active',
        isMain: false,
        createdById: 'agent-uuid-1',
        createdByType: 'agent',
        createdAt: '2026-05-12T00:00:00Z',
        updatedAt: '2026-05-12T00:00:00Z',
      }, 201));

      await client.createBranch('site-1', { name: 'minimal' });

      const [, options] = mockFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as Record<string, unknown>;
      expect(body).not.toHaveProperty('description');
      expect(body).not.toHaveProperty('parentBranchId');
    });

    it('includes agent auth headers and acting-user headers when configured', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({
        ...defaultConfig,
        actingUser: { id: 'user-99', email: 'human@example.com' },
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        id: 'b', siteId: 's', name: 'n', status: 'active', isMain: false,
        createdById: 'agent-uuid-1', createdByType: 'agent',
        createdAt: '', updatedAt: '',
      }, 201));

      await client.createBranch('site-1', { name: 'with-actor' });

      const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(options.headers['X-API-Key']).toBe('aak_test-key');
      expect(options.headers['X-Actor-Type']).toBe('agent');
      expect(options.headers['X-Actor-Id']).toBe('agent-uuid-1');
      expect(options.headers['X-Acting-User-Id']).toBe('user-99');
      expect(options.headers['X-Acting-User-Email']).toBe('human@example.com');
    });

    it('surfaces 400 (missing name) as Error', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(false, {
        error: 'Branch name is required',
      }, 400));

      await expect(
        client.createBranch('site-1', { name: '' }),
      ).rejects.toThrow('Branch name is required');
    });

    it('surfaces 404 (parent not found) as Error', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(false, {
        error: 'Parent branch not found',
      }, 404));

      await expect(
        client.createBranch('site-1', { name: 'x', parentBranchId: 'nope' }),
      ).rejects.toThrow('Parent branch not found');
    });

    it('surfaces 409 (duplicate name) as Error', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient(defaultConfig);

      mockFetch.mockResolvedValueOnce(createMockResponse(false, {
        error: 'Branch with this name already exists',
      }, 409));

      await expect(
        client.createBranch('site-1', { name: 'main' }),
      ).rejects.toThrow('Branch with this name already exists');
    });
  });

  // Tests for createDocument
  describe('createDocument', () => {
    it('creates a document with snapshot in one atomic call', async () => {
      const { McpApiClient } = await import('../../src/shared/api-client.js');
      const client = new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'a1', agentApiKey: 'aak_test' });

      mockFetch.mockResolvedValueOnce(createMockResponse(true, {
        document: { id: 'doc-1', path: '/about', siteId: 'site-1', archived: false, createdAt: '', updatedAt: '' },
        version: { id: 'ver-1', versionNumber: 1, snapshot: {}, documentId: 'doc-1', branchId: 'branch-1', source: 'edit', createdById: '', createdByType: 'agent', createdAt: '' },
      }, 201));

      const result = await client.createDocument(
        'site-1', 'branch-1', '/about', { content: [], root: { props: {} } },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1); // single atomic call
      const [url, init] = mockFetch.mock.calls[0] as [string, { body: string }];
      expect(url).toBe('http://localhost:8787/api/sites/site-1/branches/branch-1/documents');
      const body = JSON.parse(init.body) as { path: string; snapshot: unknown };
      expect(body.path).toBe('/about');
      expect(body.snapshot).toBeDefined();
      expect(result.documentId).toBe('doc-1');
      expect(result.versionId).toBe('ver-1');
      expect(result.documentPath).toBe('/about');
    });
  });
});
