import { describe, it, expect } from 'vitest';
import {
  createWebsocketConnectionUrl,
  frameLabel,
  isServerMessage,
  connectionErrorLabel,
  parseServerMessage,
  sendToAgent,
} from '../src/agentSocket.js';

describe('createWebsocketConnectionUrl', () => {
  it('swaps http for the ws scheme', () => {
    expect(createWebsocketConnectionUrl('http://localhost:8788', 'a')).toBe(
      'ws://localhost:8788/agents/chat-agent/a',
    );
  });

  it('swaps https for wss, not ws', () => {
    expect(createWebsocketConnectionUrl('https://agent.example.com', 'a')).toBe(
      'wss://agent.example.com/agents/chat-agent/a',
    );
  });

  it('does not double the slash when the base URL has a trailing one', () => {
    expect(createWebsocketConnectionUrl('http://localhost:8788/', 'a')).toBe(
      'ws://localhost:8788/agents/chat-agent/a',
    );
  });

  // Agent ids are built from user/site/branch/document values, so a document slug
  // containing a slash or space must not silently reshape the route.
  it('encodes an agent id that contains path or space characters', () => {
    expect(createWebsocketConnectionUrl('http://x', 'u-1/site 2')).toBe(
      'ws://x/agents/chat-agent/u-1%2Fsite%202',
    );
  });
});

describe('isServerMessage', () => {
  it('accepts every known frame shape', () => {
    expect(isServerMessage({ type: 'token', content: 'hi' })).toBe(true);
    expect(isServerMessage({ type: 'done' })).toBe(true);
    expect(isServerMessage({ type: 'error', error: 'boom' })).toBe(true);
    expect(isServerMessage({ type: 'tool_start', toolName: 'get_document' })).toBe(true);
    expect(isServerMessage({ type: 'tool_end', toolName: 'get_document' })).toBe(true);
    expect(isServerMessage({ type: 'history', history: [] })).toBe(true);
  });

  it('rejects non-objects and unknown types', () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage('token')).toBe(false);
    expect(isServerMessage(42)).toBe(false);
    expect(isServerMessage({})).toBe(false);
    expect(isServerMessage({ type: 'not_a_frame' })).toBe(false);
  });

  // The point of the guard: handleServerMessage dereferences these fields, so a frame
  // that names a known type but omits its payload is what actually throws downstream.
  it('rejects a known type whose required payload is missing or mistyped', () => {
    expect(isServerMessage({ type: 'token' })).toBe(false);
    expect(isServerMessage({ type: 'token', content: 42 })).toBe(false);
    expect(isServerMessage({ type: 'error' })).toBe(false);
    expect(isServerMessage({ type: 'tool_start' })).toBe(false);
    expect(isServerMessage({ type: 'tool_end', toolName: null })).toBe(false);
    expect(isServerMessage({ type: 'history' })).toBe(false);
    expect(isServerMessage({ type: 'history', history: 'nope' })).toBe(false);
  });

  it('accepts a replayed turn carrying ordered parts', () => {
    const parts = [
      { type: 'text', text: 'reading' },
      { type: 'tool', tool: { name: 'get_document', result: { ok: true } } },
    ];
    expect(isServerMessage({
      type: 'history',
      history: [{ role: 'assistant', content: 'reading', parts }],
    })).toBe(true);
  });

  it('rejects a replayed part whose payload does not match its type', () => {
    const withParts = (parts: unknown) =>
      isServerMessage({ type: 'history', history: [{ role: 'assistant', content: '', parts }] });

    expect(withParts('nope')).toBe(false);
    expect(withParts([{ type: 'text' }])).toBe(false);
    expect(withParts([{ type: 'text', text: 42 }])).toBe(false);
    expect(withParts([{ type: 'tool' }])).toBe(false);
    expect(withParts([{ type: 'tool', tool: { name: 42 } }])).toBe(false);
    expect(withParts([{ type: 'mystery' }])).toBe(false);
  });
});

describe('sendToAgent', () => {
  // The single serialization point: every client frame goes through here, so a protocol
  // change is a compile error at the call sites rather than three places to hunt down.
  it('serializes each request type onto the socket', () => {
    const sent: string[] = [];
    const ws = { send: (data: string) => sent.push(data) } as unknown as WebSocket;

    sendToAgent(ws, { type: 'get_history', token: 'tok' });
    sendToAgent(ws, { type: 'clear', token: 'tok' });

    expect(sent.map(s => JSON.parse(s))).toEqual([
      { type: 'get_history', token: 'tok' },
      { type: 'clear', token: 'tok' },
    ]);
  });
});

describe('parseServerMessage', () => {
  it('returns the frame when it is valid', () => {
    expect(parseServerMessage('{"type":"token","content":"hi"}')).toEqual({ type: 'token', content: 'hi' });
  });

  it('returns null for malformed JSON and for a valid-JSON frame of the wrong shape', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage('{"type":"token"}')).toBeNull();
  });
});


describe('frameLabel', () => {
  // Built from literals in our own source, so a crafted frame cannot reach the log line.
  it('labels each frame type', () => {
    expect(frameLabel({ type: 'done' })).toBe('done');
    expect(frameLabel({ type: 'token', content: 'x' })).toBe('token');
    expect(frameLabel({ type: 'history', history: [] })).toBe('history');
  });
});

describe('isServerMessage — version skew and render safety', () => {
  /**
   * A pre-tool-id Worker sends tool frames with no `toolCallId`. Requiring the field rejected
   * those frames wholesale, so no tool row appeared at all, instead of falling back to
   * matching by name (see `resolveToolPart`).
   */
  it('accepts a tool frame with no toolCallId', () => {
    expect(isServerMessage({ type: 'tool_end', toolName: 'get_document', toolResult: {} })).toBe(true);
  });

  it('rejects a tool frame whose toolCallId is the wrong type', () => {
    expect(isServerMessage({ type: 'tool_start', toolName: 'get_document', toolCallId: 7 })).toBe(false);
  });

  /**
   * `turnId` alone decides whether a frame is applied. A non-string one compared unequal to
   * every turn, so every frame tested as stale and the turn hung until the watchdog fired.
   */
  it('rejects a frame whose turnId is not a string', () => {
    expect(isServerMessage({ type: 'token', content: 'hi', turnId: null })).toBe(false);
    expect(isServerMessage({ type: 'done', turnId: 3 })).toBe(false);
  });

  /**
   * History entries are dereferenced during render (`part.text.trim()`), where a throw takes
   * the whole editor tree down — so the shape is checked on the way in.
   */
  it('rejects history entries that would crash rendering', () => {
    expect(isServerMessage({ type: 'history', history: [null] })).toBe(false);
    expect(isServerMessage({ type: 'history', history: [{ role: 'assistant' }] })).toBe(false);
    expect(isServerMessage({ type: 'history', history: [{ role: 'nope', content: 'x' }] })).toBe(false);
    expect(isServerMessage({ type: 'history', history: [{ role: 'assistant', content: 'x', toolCalls: [{}] }] })).toBe(false);
  });

  it('accepts a replayed turn carrying the legacy flat call list', () => {
    expect(isServerMessage({
      type: 'history',
      history: [{ role: 'assistant', content: 'done', toolCalls: [{ name: 'get_document', result: {} }] }],
    })).toBe(true);
  });
});

describe('connectionErrorLabel', () => {
  it('names each reason the agent can reject a connection', () => {
    expect(connectionErrorLabel('Authentication failed')).toBe('authentication failed');
    expect(connectionErrorLabel('Not authorized for this conversation')).toBe(
      'not authorized for this conversation',
    );
    expect(connectionErrorLabel('Invalid message format')).toBe('invalid frame');
    expect(connectionErrorLabel('Binary messages not supported')).toBe('binary frame');
  });

  // The point of mapping rather than sanitizing: nothing agent-supplied reaches the log, so a
  // crafted error can't forge an entry however it is escaped.
  it('returns a literal for anything it does not recognize', () => {
    expect(connectionErrorLabel('bad\n[p1-ai-chat] forged entry')).toBe('unrecognized');
    expect(connectionErrorLabel('x'.repeat(500))).toBe('unrecognized');
    expect(connectionErrorLabel('')).toBe('unrecognized');
  });
});
