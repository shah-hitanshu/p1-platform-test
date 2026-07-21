import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createTransport, apiErrorStatus, type TransportConfig } from './model.js';
import type { RawTool } from './tool-defs.js';

const tools: RawTool[] = [
  { name: 't1', description: 'd1', input_schema: { type: 'object', properties: {} } },
  { name: 't2', description: 'd2', input_schema: { type: 'object', properties: {} } },
];

const baseCfg: Omit<TransportConfig, 'model' | 'fetcher'> = {
  accountId: 'ACC',
  gatewayId: 'p1-chatbot',
  apiToken: 'test-token',
  tools,
};

// Capture requests the SDKs make and return a canned JSON response, exercising the real
// SDK serialization (URL, headers, body) rather than stubbing the transport itself.
function stubFetch(responseBody: unknown) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: unknown, init: { headers?: HeadersInit; body?: string } = {}) => {
    let body: Record<string, unknown> = {};
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { /* leave empty */ }
    }
    calls.push({ url: String(url), headers: new Headers(init.headers ?? {}), body });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const OPENAI_RESPONSE = {
  id: 'c', object: 'chat.completion', created: 0, model: 'm',
  choices: [{
    index: 0,
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: 'hi there',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_document', arguments: '{"site_id":"s"}' } }],
    },
  }],
  usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } },
};

const ANTHROPIC_RESPONSE = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-x',
  content: [
    { type: 'text', text: 'hello' },
    { type: 'tool_use', id: 'tu_1', name: 'get_document', input: { site_id: 's' } },
  ],
  stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 90, cache_read_input_tokens: 5 },
};

const req = { system: 'SYS', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 1024 };

describe('createTransport routing', () => {
  it('routes anthropic/* to the /ai/v1/messages endpoint', async () => {
    const { fetcher, calls } = stubFetch(ANTHROPIC_RESPONSE);
    const t = createTransport({ ...baseCfg, model: 'anthropic/claude-haiku-4-5', fetcher });
    await t.complete(req);
    expect(calls[0].url).toContain('/client/v4/accounts/ACC/ai/v1/messages');
  });

  it.each([
    '@cf/moonshotai/kimi-k2.7-code',
    'openai/gpt-4o',
    'google-ai-studio/gemini-2.5-flash',
  ])('routes %s to the /ai/v1/chat/completions endpoint', async model => {
    const { fetcher, calls } = stubFetch(OPENAI_RESPONSE);
    const t = createTransport({ ...baseCfg, model, fetcher });
    await t.complete(req);
    expect(calls[0].url).toContain('/client/v4/accounts/ACC/ai/v1/chat/completions');
  });

  it('throws when AGENT_MODEL is not provider/model notation', () => {
    expect(() => createTransport({ ...baseCfg, model: 'claude-x' })).toThrow(/provider\/model/);
    expect(() => createTransport({ ...baseCfg, model: 'anthropic/' })).toThrow(/provider\/model/);
    expect(() => createTransport({ ...baseCfg, model: '/claude-x' })).toThrow(/provider\/model/);
  });
});

describe('OpenAI transport', () => {
  it('sends Bearer auth + cf-aig-gateway-id header', async () => {
    const { fetcher, calls } = stubFetch(OPENAI_RESPONSE);
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher });
    await t.complete(req);
    expect(calls[0].headers.get('authorization')).toBe('Bearer test-token');
    expect(calls[0].headers.get('cf-aig-gateway-id')).toBe('p1-chatbot');
  });

  it('sends the full provider/model string and a leading system message', async () => {
    const { fetcher, calls } = stubFetch(OPENAI_RESPONSE);
    const t = createTransport({ ...baseCfg, model: '@cf/moonshotai/kimi-k2.7-code', fetcher });
    await t.complete(req);
    expect(calls[0].body.model).toBe('@cf/moonshotai/kimi-k2.7-code');
    const messages = calls[0].body.messages as { role: string }[];
    expect(messages[0].role).toBe('system');
  });

  it('normalizes the response to content + OpenAI-shaped tool calls + usage', async () => {
    const { fetcher } = stubFetch(OPENAI_RESPONSE);
    const t = createTransport({ ...baseCfg, model: 'openai/gpt-4o', fetcher });
    const res = await t.complete(req);
    expect(res.content).toBe('hi there');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].function.name).toBe('get_document');
    expect(res.usage?.cacheReadInputTokens).toBe(40);
  });
});

describe('Anthropic transport', () => {
  it('sends Bearer auth + cf-aig-gateway-id header and the provider-prefixed model id', async () => {
    const { fetcher, calls } = stubFetch(ANTHROPIC_RESPONSE);
    const t = createTransport({ ...baseCfg, model: 'anthropic/claude-haiku-4-5', fetcher });
    await t.complete(req);
    expect(calls[0].headers.get('authorization')).toBe('Bearer test-token');
    expect(calls[0].headers.get('cf-aig-gateway-id')).toBe('p1-chatbot');
    // REST /ai/v1/messages requires the "anthropic/" prefix (unlike the old path endpoint).
    expect(calls[0].body.model).toBe('anthropic/claude-haiku-4-5');
  });

  it('sends a system block and cache_control on system, last tool, and last message', async () => {
    const { fetcher, calls } = stubFetch(ANTHROPIC_RESPONSE);
    const t = createTransport({ ...baseCfg, model: 'anthropic/claude-haiku-4-5', fetcher });
    await t.complete(req);
    const body = calls[0].body as {
      system: { cache_control?: unknown }[];
      tools: { cache_control?: unknown }[];
      messages: { content: { cache_control?: unknown }[] }[];
    };
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools[body.tools.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    const lastMsg = body.messages[body.messages.length - 1];
    const lastBlock = lastMsg.content[lastMsg.content.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('normalizes the response including cache-creation usage', async () => {
    const { fetcher } = stubFetch(ANTHROPIC_RESPONSE);
    const t = createTransport({ ...baseCfg, model: 'anthropic/claude-haiku-4-5', fetcher });
    const res = await t.complete(req);
    expect(res.content).toBe('hello');
    expect(res.toolCalls[0].function.name).toBe('get_document');
    expect(JSON.parse(res.toolCalls[0].function.arguments)).toEqual({ site_id: 's' });
    expect(res.usage?.cacheCreationInputTokens).toBe(90);
    expect(res.usage?.cacheReadInputTokens).toBe(5);
  });
});

describe('apiErrorStatus', () => {
  it('extracts the status from an OpenAI.APIError', () => {
    const err = new OpenAI.APIError(429, undefined, 'rate limited', undefined);
    expect(apiErrorStatus(err)).toBe(429);
  });

  it('extracts the status from an Anthropic.APIError', () => {
    const err = new Anthropic.APIError(429, undefined, 'rate limited', undefined);
    expect(apiErrorStatus(err)).toBe(429);
  });

  it('returns undefined for a non-API error', () => {
    expect(apiErrorStatus(new Error('boom'))).toBeUndefined();
    expect(apiErrorStatus('nope')).toBeUndefined();
  });
});
