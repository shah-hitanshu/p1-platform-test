import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MockWebSocket, baseContext } from './testSupport.js';

/**
 * Its own file: sessions are cached module-level by conversation id, so a suite that has already
 * connected with this id would be handed the cached session and open no socket to assert on.
 */
let currentDocument: { id: string; path: string } | null = { id: 'doc1', path: '/current' };
let branchId = 'main';

vi.mock('@pantheon-systems/puck-css', () => ({
  useP1Puck: () => ({ userId: 'u1', siteId: 'site1', branchId, currentDocument }),
  useP1Auth: () => ({ getToken: async () => baseContext.token, isAuthenticated: true }),
  aiPanelStore: { close: vi.fn(), open: vi.fn(), toggle: vi.fn(), isOpen: () => true, subscribe: () => () => {} },
}));
vi.mock('@puckeditor/core', () => ({ useGetPuck: () => () => ({ dispatch: vi.fn() }) }));

const { ChatPanel } = await import('../src/ChatPanel.js');

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  currentDocument = { id: 'doc1', path: '/current' };
  branchId = 'main';
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('conversation scope', () => {
  // One test, not two, for the caching reason above.
  it('is one conversation per user per site, whatever the document and branch', async () => {
    const first = render(<ChatPanel options={{ agentUrl: 'http://agent.test' }} />);
    await act(async () => { MockWebSocket.instances[0].open(); });

    const url = 'ws://agent.test/agents/chat-agent/u1-site1';
    expect(MockWebSocket.instances[0].url).toBe(url);
    first.unmount();

    // A session that resets on navigation can't build several pages, which is the point of it.
    currentDocument = { id: 'doc2', path: '/somewhere-else' };
    branchId = 'japan-limited-editions';
    render(<ChatPanel options={{ agentUrl: 'http://agent.test' }} />);

    // A key carrying the document or branch would show up as a second, different URL.
    for (const ws of MockWebSocket.instances) expect(ws.url).toBe(url);
  });
});
