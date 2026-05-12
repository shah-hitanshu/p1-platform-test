/**
 * Presence Endpoint Tests
 *
 * Tests for presence-related API endpoints including focus region reporting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PresenceEndpoint', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';
  let client: P1Client;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new P1Client({
      baseUrl,
      apiKey,
      principal: { id: 'user-123', type: 'user' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateFocusRegions', () => {
    it('should send POST request to focus-regions endpoint', async () => {
      const mockResponse = {
        success: true,
        focusRegions: ['/content/0', '/content/1'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.presence.updateFocusRegions(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        ['/content/0', '/content/1']
      );

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fhome/focus-regions`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            actorId: 'user-123',
            focusRegions: ['/content/0', '/content/1'],
          }),
        })
      );
    });

    it('should include X-Actor-Type: user header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, focusRegions: [] }),
      });

      await client.presence.updateFocusRegions('site-1', 'branch-1', '/home', 'user-123', []);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Actor-Type': 'user',
          }),
        })
      );
    });

    it('should URL-encode document path with special characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, focusRegions: [] }),
      });

      await client.presence.updateFocusRegions(
        'site-1',
        'branch-1',
        '/pages/about-us',
        'user-123',
        ['/content/0']
      );

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches/branch-1/documents/%2Fpages%2Fabout-us/focus-regions`,
        expect.any(Object)
      );
    });

    it('should clear focus when empty array is passed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, focusRegions: [] }),
      });

      const result = await client.presence.updateFocusRegions(
        'site-1',
        'branch-1',
        '/home',
        'user-123',
        []
      );

      expect(result.focusRegions).toEqual([]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ actorId: 'user-123', focusRegions: [] }),
        })
      );
    });

    it('should handle validation error for too many regions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Too many focus regions (max 50)' }),
      });

      await expect(
        client.presence.updateFocusRegions('site-1', 'branch-1', '/home', 'user-123', Array(51).fill('/content/0'))
      ).rejects.toThrow('Too many focus regions');
    });

    it('should handle forbidden error for agent requests', async () => {
      // Create an agent client
      const agentClient = new P1Client({
        baseUrl,
        apiKey,
        principal: { id: 'agent-1', type: 'agent' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Focus regions can only be set by users' }),
      });

      await expect(
        agentClient.presence.updateFocusRegions('site-1', 'branch-1', '/home', 'agent-1', ['/content/0'])
      ).rejects.toThrow();
    });
  });

  describe('getSitePresence', () => {
    it('should fetch site-level presence', async () => {
      const mockPresence = {
        siteId: 'site-1',
        siteName: 'Test Site',
        summary: {
          totalActors: 3,
          humanCount: 2,
          agentCount: 1,
          activeBranches: 2,
        },
        branches: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPresence,
      });

      const result = await client.presence.getSitePresence('site-1');

      expect(result).toEqual(mockPresence);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/presence`,
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('getBranchPresence', () => {
    it('should fetch branch-level presence with focus regions', async () => {
      const mockPresence = {
        branchId: 'branch-1',
        branchName: 'main',
        siteId: 'site-1',
        summary: {
          totalActors: 2,
          humanCount: 1,
          agentCount: 1,
          editingCount: 0,
        },
        actors: [
          {
            id: 'presence-1',
            actorId: 'user-123',
            actorType: 'user',
            role: 'human',
            name: 'Test User',
            state: 'active',
            focusRegions: ['/content/0', '/content/1'],
            lastActivityAt: '2024-01-01T00:00:00Z',
            joinedAt: '2024-01-01T00:00:00Z',
          },
        ],
        documentSummary: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPresence,
      });

      const result = await client.presence.getBranchPresence('site-1', 'branch-1');

      expect(result).toEqual(mockPresence);
      expect(result.actors[0].focusRegions).toEqual(['/content/0', '/content/1']);
    });
  });

  describe('getAgentPresence', () => {
    it('should fetch agent global presence', async () => {
      const mockPresence = {
        agentId: 'agent-1',
        agentName: 'Test Agent',
        organizationId: 'org-1',
        locations: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPresence,
      });

      const result = await client.presence.getAgentPresence('org-1', 'agent-1');

      expect(result).toEqual(mockPresence);
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/organizations/org-1/agents/agent-1/presence`,
        expect.objectContaining({ method: 'GET' })
      );
    });
  });
});
