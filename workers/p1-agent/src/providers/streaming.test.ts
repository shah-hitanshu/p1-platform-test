import { describe, it, expect } from 'vitest';
import type { RawTool } from '../tools/definitions.js';
import { createTransport, type TransportConfig, type StreamHandlers } from './transport.js';

const tools: RawTool[] = [
  { name: 'get_document', description: 'd', input_schema: { type: 'object', properties: {} } },
];

const baseCfg: Omit<TransportConfig, 'model' | 'fetcher'> = {
  accountId: 'ACC',
  gatewayId: 'p1-chatbot',
  apiToken: 'test-token',
  tools,
};

/**
 * Serve a canned SSE stream through the real SDK parsers, so these tests cover the
 * actual event decoding rather than a stubbed transport.
 */
function stubSse(frames: string[]) {
  const fetcher = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
  return fetcher;
}

/** Collect what the agent loop would forward to the client. */
function recorder() {
  const text: string[] = [];
  const started: { id: string; name: string }[] = [];
  const handlers: StreamHandlers = {
    onText: d => text.push(d),
    onToolCallStart: c => started.push(c),
  };
  return { handlers, text, started };
}

const openAiFrame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
const chunk = (delta: unknown): string =>
  openAiFrame({
    id: 'c',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: null }],
  });

const anthropicFrame = (type: string, o: unknown): string =>
  `event: ${type}\ndata: ${JSON.stringify(o)}\n\n`;

describe('OpenAI transport streaming', () => {
  const frames = [
    chunk({ role: 'assistant', content: 'Hel' }),
    chunk({ content: 'lo' }),
    // Tool call arrives fragmented: id+name first, then arguments across several deltas.
    chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_document', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"site_id"' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: ':"s"}' } }] }),
    openAiFrame({
      id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
      choices: [],
      usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } },
    }),
    'data: [DONE]\n\n',
  ];

  it('forwards text deltas in order and returns the joined content', async () => {
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher: stubSse(frames) });
    const { handlers, text } = recorder();
    const result = await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, handlers);

    expect(text).toEqual(['Hel', 'lo']);
    expect(result.content).toBe('Hello');
  });

  it('reassembles fragmented tool-call arguments into one call', async () => {
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher: stubSse(frames) });
    const { handlers } = recorder();
    const result = await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, handlers);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('call_1');
    expect(result.toolCalls[0].function.name).toBe('get_document');
    expect(JSON.parse(result.toolCalls[0].function.arguments)).toEqual({ site_id: 's' });
  });

  it('announces each tool call exactly once, as soon as its name is known', async () => {
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher: stubSse(frames) });
    const { handlers, started } = recorder();
    await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, handlers);

    // Announced once despite arguments spanning three further deltas.
    expect(started).toEqual([{ id: 'call_1', name: 'get_document' }]);
  });

  it('keeps two concurrent calls to the same tool separate', async () => {
    const twoCalls = [
      chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_document', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_document', arguments: '' } }] }),
      // Interleaved argument fragments — the reason accumulation is keyed by index.
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"p":"a"}' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: '{"p":"b"}' } }] }),
      'data: [DONE]\n\n',
    ];
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher: stubSse(twoCalls) });
    const { handlers, started } = recorder();
    const result = await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, handlers);

    expect(started.map(s => s.id)).toEqual(['call_a', 'call_b']);
    expect(result.toolCalls.map(c => c.id)).toEqual(['call_a', 'call_b']);
    expect(JSON.parse(result.toolCalls[0].function.arguments)).toEqual({ p: 'a' });
    expect(JSON.parse(result.toolCalls[1].function.arguments)).toEqual({ p: 'b' });
  });

  it('still announces and pairs a tool call when the provider omits an id', async () => {
    // Not every provider behind the compat endpoint sends tool_call ids. Without a
    // fallback the call is never announced and its result pairs with nothing, so the
    // badge silently disappears from the transcript.
    const noId = [
      chunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'get_document', arguments: '{}' } }] }),
      'data: [DONE]\n\n',
    ];
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher: stubSse(noId) });
    const { handlers, started } = recorder();
    const result = await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, handlers);

    expect(started).toHaveLength(1);
    expect(started[0].name).toBe('get_document');
    expect(started[0].id).toBeTruthy();
    // The announced id must equal the one the agent loop reports on tool_end.
    expect(result.toolCalls[0].id).toBe(started[0].id);
  });

  it('captures usage from the trailing usage-only chunk', async () => {
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher: stubSse(frames) });
    const { handlers } = recorder();
    const result = await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, handlers);

    expect(result.usage?.inputTokens).toBe(50);
    expect(result.usage?.cacheReadInputTokens).toBe(40);
  });
});

describe('Anthropic transport streaming', () => {
  const frames = [
    anthropicFrame('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 },
      },
    }),
    anthropicFrame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    anthropicFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
    anthropicFrame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
    anthropicFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    anthropicFrame('content_block_start', {
      type: 'content_block_start', index: 1,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'get_document', input: {} },
    }),
    anthropicFrame('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"site_id"' } }),
    anthropicFrame('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"s"}' } }),
    anthropicFrame('content_block_stop', { type: 'content_block_stop', index: 1 }),
    anthropicFrame('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }),
    anthropicFrame('message_stop', { type: 'message_stop' }),
  ];

  const run = async () => {
    const t = createTransport({ ...baseCfg, model: 'anthropic/claude-haiku-4-5', fetcher: stubSse(frames) });
    const rec = recorder();
    const result = await t.stream({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, rec.handlers);
    return { ...rec, result };
  };

  it('forwards text deltas and omits tool-argument deltas from the text stream', async () => {
    const { text, result } = await run();
    expect(text).toEqual(['Hel', 'lo']);
    // input_json_delta must not leak into assistant text.
    expect(result.content).toBe('Hello');
  });

  it('announces the tool call at content_block_start, before its input streams', async () => {
    const { started } = await run();
    expect(started).toEqual([{ id: 'tu_1', name: 'get_document' }]);
  });

  it('returns the assembled tool call and cache usage from finalMessage', async () => {
    const { result } = await run();
    expect(result.toolCalls).toHaveLength(1);
    expect(JSON.parse(result.toolCalls[0].function.arguments)).toEqual({ site_id: 's' });
    expect(result.usage?.cacheReadInputTokens).toBe(7);
    expect(result.usage?.cacheCreationInputTokens).toBe(3);
  });
});
