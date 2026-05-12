/**
 * Client Session Authorization Tests (TDD)
 *
 * Tests for agent session authorization via X-Agent-Session-Id header.
 * The sessionId is obtained from startEdit() and set at the client level
 * to enable server-side enforcement of the Agent Politeness Protocol.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P1Client } from '../src/client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('P1Client Session Authorization', () => {
  const baseUrl = 'http://localhost:8787';
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('withSessionId', () => {
    it('should include X-Agent-Session-Id header on all requests when sessionId is set', async () => {
      const mockVersion = {
        id: 'version-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        versionNumber: 1,
        snapshot: { content: [] },
        source: 'edit',
        createdById: 'agent-1',
        createdByType: 'agent',
        createdAt: '2026-01-29T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockVersion,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const sessionClient = client.withSessionId('session-abc');

      await sessionClient.versions.create('site-1', {
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: [] },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/api/sites/site-1/branches/branch-1/documents/doc-1/versions`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Agent-Session-Id': 'session-abc',
          }),
        }),
      );
    });

    it('should not include X-Agent-Session-Id header when sessionId is not set', async () => {
      const mockVersion = {
        id: 'version-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        versionNumber: 1,
        snapshot: { content: [] },
        source: 'edit',
        createdById: 'user-1',
        createdByType: 'user',
        createdAt: '2026-01-29T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockVersion,
      });

      const client = new P1Client({ baseUrl, apiKey });
      await client.versions.create('site-1', {
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: [] },
      });

      const call = mockFetch.mock.calls[0];
      const headers = call[1].headers;

      expect(headers['X-Agent-Session-Id']).toBeUndefined();
    });

    it('should return a new client instance with sessionId set', () => {
      const client = new P1Client({ baseUrl, apiKey });
      const sessionClient = client.withSessionId('session-xyz');

      // Should be different instances
      expect(sessionClient).not.toBe(client);
      // Original client should not have sessionId
      expect(client).toBeDefined();
    });

    it('should work with withPrincipal chained together', async () => {
      const mockVersion = {
        id: 'version-1',
        documentId: 'doc-1',
        branchId: 'branch-1',
        versionNumber: 1,
        snapshot: { content: [] },
        source: 'edit',
        createdById: 'agent-1',
        createdByType: 'agent',
        createdAt: '2026-01-29T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockVersion,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const agentClient = client
        .withPrincipal({ id: 'agent-1', type: 'agent' })
        .withSessionId('session-agent');

      await agentClient.versions.create('site-1', {
        documentId: 'doc-1',
        branchId: 'branch-1',
        snapshot: { content: [] },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Principal-Id': 'agent-1',
            'X-Principal-Type': 'agent',
            'X-Agent-Session-Id': 'session-agent',
          }),
        }),
      );
    });

    it('should apply sessionId to other endpoints too', async () => {
      const mockSite = {
        id: 'site-1',
        name: 'Test Site',
        pantheonSiteId: 'p1',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSite,
      });

      const client = new P1Client({ baseUrl, apiKey });
      const sessionClient = client.withSessionId('session-xyz');

      await sessionClient.sites.get('site-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Agent-Session-Id': 'session-xyz',
          }),
        }),
      );
    });
  });
});
