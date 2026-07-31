import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  toAnthropicMessages,
  toAnthropicTools,
  withRollingBreakpoint,
  fromAnthropicResponse,
} from './anthropic.js';
import type { ChatMessage } from './model.js';
import type { RawTool } from './tool-defs.js';

// Message builders mirroring the OpenAI shapes the agentic loop persists.
const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });
const assistantTools = (
  calls: { id: string; name?: string; args?: string }[],
  content = '',
): ChatMessage => ({
  role: 'assistant',
  content,
  tool_calls: calls.map(c => ({
    id: c.id,
    type: 'function',
    function: { name: c.name ?? 'get_document', arguments: c.args ?? '{}' },
  })),
});
const toolResult = (id: string, content = 'ok'): ChatMessage => ({ role: 'tool', tool_call_id: id, content });

// Narrow content to the block-array form our adapter always produces.
function blocks(msg: Anthropic.MessageParam): Anthropic.ContentBlockParam[] {
  if (!Array.isArray(msg.content)) throw new Error('expected block-array content');
  return msg.content;
}

describe('toAnthropicMessages', () => {
  it('maps a user string to a single text block', () => {
    const out = toAnthropicMessages([user('hi')]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    expect(blocks(out[0])).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('maps assistant text to a text block', () => {
    const out = toAnthropicMessages([user('q'), assistant('an answer')]);
    expect(out[1].role).toBe('assistant');
    expect(blocks(out[1])).toEqual([{ type: 'text', text: 'an answer' }]);
  });

  it('omits the empty text block when the assistant only calls tools', () => {
    const out = toAnthropicMessages([user('q'), assistantTools([{ id: 'a' }])]);
    const b = blocks(out[1]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ type: 'tool_use', id: 'a', name: 'get_document', input: {} });
  });

  it('keeps assistant text alongside multiple tool_use blocks', () => {
    const out = toAnthropicMessages([
      user('q'),
      assistantTools([{ id: 'a', name: 'get_document' }, { id: 'b', name: 'list_media' }], 'working on it'),
    ]);
    const b = blocks(out[1]);
    expect(b).toHaveLength(3);
    expect(b[0]).toEqual({ type: 'text', text: 'working on it' });
    expect(b[1]).toMatchObject({ type: 'tool_use', id: 'a' });
    expect(b[2]).toMatchObject({ type: 'tool_use', id: 'b' });
  });

  it('merges consecutive tool results into one user message', () => {
    const out = toAnthropicMessages([
      user('do it'),
      assistantTools([{ id: 'a' }, { id: 'b' }]),
      toolResult('a', 'r1'),
      toolResult('b', 'r2'),
    ]);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe('user');
    const b = blocks(out[2]);
    expect(b).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'r1' },
      { type: 'tool_result', tool_use_id: 'b', content: 'r2' },
    ]);
  });

  it('drops an orphaned tool result whose tool_use was never seen', () => {
    const out = toAnthropicMessages([user('x'), toolResult('missing')]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('does not open with an orphan tool_result when history starts mid-tool-turn', () => {
    // If input begins with an assistant tool_use turn (its tool_use gets dropped as a
    // leading non-user message), the following tool_result must not become the opening
    // message — Anthropic rejects a leading tool_result.
    const out = toAnthropicMessages([
      assistantTools([{ id: 'a' }]),
      toolResult('a', 'r1'),
      user('real question'),
    ]);
    expect(out[0].role).toBe('user');
    const first = blocks(out[0]);
    expect(first[0].type).not.toBe('tool_result');
    expect(first).toEqual([{ type: 'text', text: 'real question' }]);
  });

  it('falls back to {} for malformed tool_call arguments', () => {
    const out = toAnthropicMessages([user('q'), assistantTools([{ id: 'a', args: '{not json' }])]);
    expect(blocks(out[1])[0]).toMatchObject({ type: 'tool_use', input: {} });
  });

  it('drops leading non-user entries and stray system messages', () => {
    const out = toAnthropicMessages([
      { role: 'system', content: 'sys' } as ChatMessage,
      assistant('orphan reply'),
      user('real question'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    expect(blocks(out[0])).toEqual([{ type: 'text', text: 'real question' }]);
  });

  it('produces strictly alternating roles across a full turn', () => {
    const out = toAnthropicMessages([
      user('turn1'),
      assistant('answer1'),
      user('turn2'),
      assistantTools([{ id: 'a' }]),
      toolResult('a'),
      assistant('answer2'),
    ]);
    const roles = out.map(m => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  });
});

describe('toAnthropicTools', () => {
  const raw: RawTool[] = [
    { name: 't1', description: 'd1', input_schema: { type: 'object', properties: {} } },
    { name: 't2', description: 'd2', input_schema: { type: 'object', properties: {} } },
  ];

  it('maps name/description/input_schema through', () => {
    const out = toAnthropicTools(raw);
    expect(out[0]).toMatchObject({ name: 't1', description: 'd1', input_schema: { type: 'object' } });
  });

  it('puts a cache_control breakpoint only on the last tool', () => {
    const out = toAnthropicTools(raw);
    expect(out[0].cache_control).toBeUndefined();
    expect(out[1].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('withRollingBreakpoint', () => {
  it('marks the final block of the last message', () => {
    const msgs = toAnthropicMessages([user('a'), assistant('b')]);
    const out = withRollingBreakpoint(msgs);
    const last = blocks(out[out.length - 1]);
    expect(last[last.length - 1]).toMatchObject({ cache_control: { type: 'ephemeral' } });
    // Earlier messages are untouched.
    expect(blocks(out[0])[0]).not.toHaveProperty('cache_control');
  });

  it('is a no-op on empty input', () => {
    expect(withRollingBreakpoint([])).toEqual([]);
  });
});

describe('fromAnthropicResponse', () => {
  const make = (content: Anthropic.ContentBlock[], usage?: Partial<Anthropic.Usage>): Anthropic.Message =>
    ({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-x',
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        ...usage,
      },
    }) as Anthropic.Message;

  it('joins text blocks into content', () => {
    const res = fromAnthropicResponse(make([
      { type: 'text', text: 'hello ', citations: null },
      { type: 'text', text: 'world', citations: null },
    ] as Anthropic.ContentBlock[]));
    expect(res.content).toBe('hello world');
    expect(res.toolCalls).toEqual([]);
  });

  it('converts tool_use blocks to OpenAI-shaped tool calls', () => {
    const res = fromAnthropicResponse(make([
      { type: 'tool_use', id: 'tu_1', name: 'get_document', input: { site_id: 's' } },
    ] as Anthropic.ContentBlock[]));
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({ id: 'tu_1', type: 'function' });
    expect(res.toolCalls[0].function.name).toBe('get_document');
    expect(JSON.parse(res.toolCalls[0].function.arguments)).toEqual({ site_id: 's' });
  });

  it('handles interleaved text and tool_use', () => {
    const res = fromAnthropicResponse(make([
      { type: 'text', text: 'let me check', citations: null },
      { type: 'tool_use', id: 'tu_1', name: 'get_document', input: {} },
    ] as Anthropic.ContentBlock[]));
    expect(res.content).toBe('let me check');
    expect(res.toolCalls).toHaveLength(1);
  });

  it('returns empty content for an empty response', () => {
    const res = fromAnthropicResponse(make([]));
    expect(res.content).toBe('');
    expect(res.toolCalls).toEqual([]);
  });

  it('maps cache usage fields (null -> undefined)', () => {
    const res = fromAnthropicResponse(make([{ type: 'text', text: 'x', citations: null }] as Anthropic.ContentBlock[], {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 90,
      cache_read_input_tokens: 0,
    }));
    expect(res.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 90,
      cacheReadInputTokens: 0,
    });
  });
});
