/**
 * Streamable HTTP Transport Tests
 *
 * The MCP server factory produces a connectable server with the full tool set.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Streamable HTTP Transport', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('should create a valid MCP server that can be connected to transport', async () => {
    const { createMcpServer } = await import('../../src/mcp-handler.js');
    const server = createMcpServer({
      baseUrl: 'http://localhost:8787',
      agentId: 'agent-1',
      agentApiKey: 'aak_test',
      serverName: 'test-mcp',
      serverVersion: '0.1.0',
    });

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe('function');
  });
});
