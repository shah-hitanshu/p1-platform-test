/**
 * Editing tools offered to a signed-in person.
 *
 * A person authenticated over OAuth can own an edit session, so the whole
 * authoring round-trip is offered to them: read a document, check permission,
 * open a session, apply edits, then complete or abort it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const EDIT_SESSION_TOOLS = [
  'check_edit_permission',
  'start_edit_session',
  'apply_document_edits',
  'complete_edit_session',
  'abort_edit_session',
];

async function registeredToolsFor(
  config: { accessToken?: string; agentApiKey?: string; actingUser?: { id: string; email: string } },
): Promise<string[]> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const registerSpy = vi.spyOn(McpServer.prototype, 'registerTool');

  const { createMcpServer } = await import('../src/mcp-handler.js');
  createMcpServer({
    baseUrl: 'http://localhost:8787',
    serverName: 'test-mcp',
    serverVersion: '0.1.0',
    ...config,
  });

  return registerSpy.mock.calls.map((call) => call[0]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a signed-in person', () => {
  it('is offered every edit-session tool', async () => {
    const registered = await registeredToolsFor({
      accessToken: 'auth0-access-token',
      actingUser: { id: 'u1', email: 'u@ex.com' },
    });

    for (const tool of EDIT_SESSION_TOOLS) {
      expect(registered).toContain(tool);
    }
  });

  it('keeps the reading and page-creation tools', async () => {
    const registered = await registeredToolsFor({
      accessToken: 'auth0-access-token',
      actingUser: { id: 'u1', email: 'u@ex.com' },
    });

    expect(registered).toContain('list_sites');
    expect(registered).toContain('get_document');
    expect(registered).toContain('create_page');
  });

  it('is offered the same tools as an agent', async () => {
    const forPerson = await registeredToolsFor({
      accessToken: 'auth0-access-token',
      actingUser: { id: 'u1', email: 'u@ex.com' },
    });
    vi.restoreAllMocks();
    const forAgent = await registeredToolsFor({ agentApiKey: 'aak_test' });

    expect([...forPerson].sort()).toEqual([...forAgent].sort());
  });
});
