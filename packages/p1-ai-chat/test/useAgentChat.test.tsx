import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentChat } from '../src/useAgentChat.js';
import type { ChatContext } from '../src/types.js';

/** Minimal controllable WebSocket stand-in — captures sent frames, opens on demand. */
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

const baseContext: ChatContext = {
  siteId: 'site1',
  branchId: 'main',
  documentPath: '/current',
  documentId: 'doc1',
  token: 'tok',
};

function chatFrames(ws: MockWebSocket): { type: string; message: string; context: ChatContext }[] {
  return ws.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'chat');
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Chat sessions are cached module-level and keyed by agentId, so a live socket
// deliberately outlives any single mount. Give each test its own scope, otherwise
// later tests would silently reattach to the first test's session (and its socket)
// instead of opening the connection they assert against.
let scopeCounter = 0;

async function mountConnected(getContext = vi.fn(async () => baseContext)) {
  const agentId = `user-site-${++scopeCounter}`;
  const hook = renderHook(() => useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext }));
  // The mount effect opens a connection; drive it to OPEN so sends resolve.
  await act(async () => {
    MockWebSocket.instances[0].open();
  });
  return { ...hook, ws: () => MockWebSocket.instances[0] };
}

describe('per-turn context overrides', () => {
  async function sendWith(opts: { documentPath?: string; newPage?: boolean }) {
    const agentId = `ctx-scope-${++scopeCounter}`;
    const getContext = vi.fn(async () => baseContext);
    const hook = renderHook(() => useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext }));
    await act(async () => { MockWebSocket.instances[0].open(); });
    await act(async () => { await hook.result.current.sendMessage('build a pricing page', opts); });
    const frame = JSON.parse(
      MockWebSocket.instances[0].sent.filter(s => s.includes('"chat"'))[0],
    ) as { message: string; context: Record<string, unknown> };
    return frame;
  }

  // The instruction to draft rather than ask rides in the context, so the transcript keeps
  // showing only what the user wrote. Appending it to the brief leaked it into the chat.
  it('sends newPage in the context, leaving the brief untouched', async () => {
    const frame = await sendWith({ documentPath: '/pricing', newPage: true });

    expect(frame.context.newPage).toBe(true);
    expect(frame.context.documentPath).toBe('/pricing');
    expect(frame.message).toBe('build a pricing page');
  });

  it('omits newPage entirely on an ordinary typed turn', async () => {
    const frame = await sendWith({});

    expect('newPage' in frame.context).toBe(false);
    expect(frame.context.documentPath).toBe(baseContext.documentPath);
  });
});

describe('useAgentChat.sendMessage', () => {
  it('overrides the turn documentPath so the agent targets the newly created page', async () => {
    const { result, ws } = await mountConnected();

    await act(async () => {
      await result.current.sendMessage('draft a landing page', { documentPath: '/new-page' });
    });

    const frames = chatFrames(ws());
    expect(frames).toHaveLength(1);
    expect(frames[0].message).toBe('draft a landing page');
    expect(frames[0].context.documentPath).toBe('/new-page');
    // Other context fields are preserved.
    expect(frames[0].context.siteId).toBe('site1');
    expect(frames[0].context.token).toBe('tok');
  });

  it('falls back to the base context documentPath when no override is given', async () => {
    const { result, ws } = await mountConnected();

    await act(async () => {
      await result.current.sendMessage('hi');
    });

    expect(chatFrames(ws())[0].context.documentPath).toBe('/current');
  });

  it('trims the message and ignores empty/whitespace input', async () => {
    const { result, ws } = await mountConnected();

    await act(async () => {
      await result.current.sendMessage('   ');
    });
    expect(chatFrames(ws())).toHaveLength(0);

    await act(async () => {
      await result.current.sendMessage('  build it  ');
    });
    expect(chatFrames(ws())[0].message).toBe('build it');
  });

  it('submit() sends the trimmed input box value as a chat turn', async () => {
    const { result, ws } = await mountConnected();

    act(() => {
      result.current.setInput('  make a page  ');
    });
    await act(async () => {
      await result.current.submit();
    });

    const frames = chatFrames(ws());
    expect(frames).toHaveLength(1);
    expect(frames[0].message).toBe('make a page');
  });
});

describe('superseded sockets', () => {
  /**
   * A failed connect leaves the dead socket's handlers attached. The caller retries and
   * opens a replacement, and only then does the dead socket's `onclose` arrive. It must
   * not write to the session: doing so discarded the live socket and reported the
   * connection lost while it was in fact open.
   */
  it('ignores a dead socket closing after a replacement has opened', async () => {
    const agentId = `stale-scope-${++scopeCounter}`;
    const hook = renderHook(() =>
      useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext: vi.fn(async () => baseContext) }),
    );

    const first = MockWebSocket.instances[0];
    // First attempt fails before opening, which is what frees the session to retry.
    await act(async () => {
      first.onerror?.();
    });

    // Retry: a send opens a replacement socket, which comes up fine.
    const sendPromise = act(async () => {
      void hook.result.current.sendMessage('hello');
    });
    const second = MockWebSocket.instances[1];
    await act(async () => {
      second.open();
    });
    await sendPromise;
    expect(hook.result.current.ready).toBe(true);

    // Now the original socket finally closes.
    await act(async () => {
      first.onclose?.();
    });

    // The live connection must be untouched.
    expect(hook.result.current.ready).toBe(true);
  });

  it('ignores frames arriving on a socket the session has let go of', async () => {
    const agentId = `stale-frames-${++scopeCounter}`;
    const hook = renderHook(() =>
      useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext: vi.fn(async () => baseContext) }),
    );

    const first = MockWebSocket.instances[0];
    await act(async () => {
      first.onerror?.();
    });
    const sendPromise = act(async () => {
      void hook.result.current.sendMessage('hello');
    });
    const second = MockWebSocket.instances[1];
    await act(async () => {
      second.open();
    });
    await sendPromise;

    const before = hook.result.current.messages.map(m => m.content);
    await act(async () => {
      first.onmessage?.({ data: JSON.stringify({ type: 'token', content: 'from the dead socket' }) });
    });

    expect(hook.result.current.messages.map(m => m.content)).toEqual(before);
  });
});
