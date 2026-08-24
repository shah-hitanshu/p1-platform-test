import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentChat } from '../src/hooks/useAgentChat.js';
import { MockWebSocket, baseContext } from './testSupport.js';

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});
afterEach(() => { vi.unstubAllGlobals(); });

// Sessions are cached module-level by agentId, so each test needs its own scope.
let scopeCounter = 0;

async function mountAndSend() {
  const agentId = `stream-scope-${++scopeCounter}`;
  const getContext = vi.fn(async () => baseContext);
  const hook = renderHook(() => useAgentChat({ agentUrl: 'http://agent.test', agentId, getContext }));
  await act(async () => { MockWebSocket.instances[0].open(); });
  await act(async () => { await hook.result.current.sendMessage('go'); });
  const ws = MockWebSocket.instances[0];
  const assistant = () => hook.result.current.messages.find(m => m.role === 'assistant');
  return { ...hook, ws, assistant };
}

describe('streamed token deltas', () => {
  it('accumulates successive token frames into one assistant message', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: 'Build' });
      ws.emit({ type: 'token', content: 'ing your ' });
      ws.emit({ type: 'token', content: 'page.' });
    });

    expect(assistant()?.content).toBe('Building your page.');
    expect(assistant()?.isStreaming).toBe(true);
  });

  it('clears the streaming flag and stops loading on done', async () => {
    const { ws, assistant, result } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: 'Done!' });
      ws.emit({ type: 'done' });
    });

    expect(assistant()?.isStreaming).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('tool call attribution', () => {
  it('keeps two concurrent calls to the same tool separate', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'tool_start', toolCallId: 'call_a', toolName: 'get_document' });
      ws.emit({ type: 'tool_start', toolCallId: 'call_b', toolName: 'get_document' });
    });
    expect(assistant()?.toolCalls).toHaveLength(2);

    // Only the first call resolves.
    await act(async () => {
      ws.emit({
        type: 'tool_end',
        toolCallId: 'call_a',
        toolName: 'get_document',
        toolInput: { document_path: '/a' },
        toolResult: { documentId: 'A' },
      });
    });

    const calls = assistant()?.toolCalls ?? [];
    expect(calls.filter(c => c.status === 'done')).toHaveLength(1);
    expect(calls.filter(c => c.status === 'running')).toHaveLength(1);
    // ...and the result landed on the right one.
    expect(calls.find(c => c.id === 'call_a')?.result).toEqual({ documentId: 'A' });
    expect(calls.find(c => c.id === 'call_b')?.result).toBeUndefined();
  });

  it('attaches the input arriving with tool_end, since tool_start announces before args stream', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'apply_document_edits' });
    });
    expect(assistant()?.toolCalls?.[0].input).toBeUndefined();

    await act(async () => {
      ws.emit({
        type: 'tool_end',
        toolCallId: 'c1',
        toolName: 'apply_document_edits',
        toolInput: { operations: [{}, {}] },
        toolResult: { success: true, operationsApplied: 2 },
      });
    });

    expect(assistant()?.toolCalls?.[0].input).toEqual({ operations: [{}, {}] });
    expect(assistant()?.toolCalls?.[0].status).toBe('done');
  });

  it('falls back to matching one call by name when the worker sends no id (version skew)', async () => {
    const { ws, assistant } = await mountAndSend();

    // A pre-tool-id Worker: no toolCallId on either frame.
    await act(async () => {
      ws.emit({ type: 'tool_start', toolName: 'get_document' });
      ws.emit({ type: 'tool_start', toolName: 'get_document' });
      ws.emit({ type: 'tool_end', toolName: 'get_document', toolResult: { documentId: 'A' } });
    });

    const calls = assistant()?.toolCalls ?? [];
    // Exactly one resolves — the old code marked both done with the same result.
    expect(calls.filter(c => c.status === 'done')).toHaveLength(1);
    expect(calls.filter(c => c.status === 'running')).toHaveLength(1);
  });

  it('ignores a tool_end whose id matches no announced call', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'tool_end', toolCallId: 'unknown', toolName: 'get_document', toolResult: {} });
    });

    expect(assistant()?.toolCalls?.[0].status).toBe('running');
  });
});

describe('interleaved text and tool calls', () => {
  it('keeps prose either side of a tool call in separate parts, not one run-on string', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: "I'll fetch that document for you." });
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'tool_end', toolCallId: 'c1', toolName: 'get_document', toolResult: { error: 'nope' } });
      ws.emit({ type: 'token', content: "That page doesn't exist." });
    });

    const parts = assistant()?.parts ?? [];
    expect(parts.map(p => (p.type === 'text' ? p.text : `tool:${p.tool.name}`))).toEqual([
      "I'll fetch that document for you.",
      'tool:get_document',
      "That page doesn't exist.",
    ]);
  });

  it('accumulates deltas within one text part rather than splitting per frame', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: 'Hello' });
      ws.emit({ type: 'token', content: ' there' });
    });

    const parts = assistant()?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: 'text', text: 'Hello there' });
  });

  it('records the tool part in call order and resolves it in place on tool_end', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'tool_start', toolCallId: 'c2', toolName: 'list_components' });
      ws.emit({ type: 'tool_end', toolCallId: 'c1', toolName: 'get_document', toolResult: { ok: true } });
    });

    const parts = assistant()?.parts ?? [];
    expect(parts).toHaveLength(2);
    // Order is preserved: resolving c1 must not move it after c2.
    expect(parts[0]).toMatchObject({ type: 'tool', tool: { id: 'c1', status: 'done' } });
    expect(parts[1]).toMatchObject({ type: 'tool', tool: { id: 'c2', status: 'running' } });
  });

  it('starts a fresh text part after each tool call, so three calls yield four text parts', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: 'one' });
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'token', content: 'two' });
      ws.emit({ type: 'tool_start', toolCallId: 'c2', toolName: 'list_components' });
      ws.emit({ type: 'token', content: 'three' });
    });

    const parts = assistant()?.parts ?? [];
    expect(parts.filter(p => p.type === 'text')).toHaveLength(3);
    expect(parts.map(p => p.type)).toEqual(['text', 'tool', 'text', 'tool', 'text']);
  });

  it('still exposes the concatenated content, which is what history persists', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: 'before ' });
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'token', content: 'after' });
    });

    expect(assistant()?.content).toBe('before after');
    // The flat tool list stays in sync for the same reason.
    expect(assistant()?.toolCalls).toHaveLength(1);
  });
});

describe('interleaving edge cases', () => {
  it('does not fuse the second turn onto the first turn parts', async () => {
    const { ws, assistant, result } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'token', content: 'first answer' });
      ws.emit({ type: 'done' });
    });
    await act(async () => { await result.current.sendMessage('again'); });
    await act(async () => { ws.emit({ type: 'token', content: 'second answer' }); });

    const assistants = result.current.messages.filter(m => m.role === 'assistant');
    expect(assistants).toHaveLength(2);
    // Each turn owns its parts; the second must not extend the first.
    expect(assistants[0].parts?.map(p => (p.type === 'text' ? p.text : p.type))).toEqual(['first answer']);
    expect(assistants[1].parts?.map(p => (p.type === 'text' ? p.text : p.type))).toEqual(['second answer']);
    expect(assistant()).toBeTruthy();
  });

  it('keeps the derived tool list in step with the ordered parts', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'token', content: 'mid' });
      ws.emit({ type: 'tool_start', toolCallId: 'c2', toolName: 'list_components' });
      ws.emit({ type: 'tool_end', toolCallId: 'c2', toolName: 'list_components', toolResult: { ok: 1 } });
    });

    const m = assistant();
    const fromParts = (m?.parts ?? []).flatMap(p => (p.type === 'tool' ? [p.tool] : []));
    expect(m?.toolCalls).toEqual(fromParts);
    expect(m?.toolCalls?.map(t => t.id)).toEqual(['c1', 'c2']);
  });

  it('a tool call arriving before any prose leaves no leading empty text part', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => {
      ws.emit({ type: 'tool_start', toolCallId: 'c1', toolName: 'get_document' });
      ws.emit({ type: 'token', content: 'after' });
    });

    expect(assistant()?.parts?.map(p => p.type)).toEqual(['tool', 'text']);
  });

  it('resets the open part when the connection drops mid-stream', async () => {
    const { ws, assistant } = await mountAndSend();

    await act(async () => { ws.emit({ type: 'token', content: 'partial' }); });
    await act(async () => { ws.close(); });

    expect(assistant()?.error).toBe('Connection lost');
    expect(assistant()?.parts?.map(p => (p.type === 'text' ? p.text : p.type))).toEqual(['partial']);
  });
});
