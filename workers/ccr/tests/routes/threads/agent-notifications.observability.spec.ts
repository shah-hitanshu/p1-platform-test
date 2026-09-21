/** What the agent-mention delivery path says about itself, as a dashboard would see it. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contextFromRequest, withRequestContext } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../../../src/env';
import { notifyMentionedAgents } from '../../../src/routes/threads/agent-notifications';
import { AGENT_ID, COMMENT_ID, SITE_ID, THREAD_ID, makeComment } from '../../helpers/threads';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@pantheon-systems/p1-telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pantheon-systems/p1-telemetry')>();
  return { ...actual, getLogger: () => logger };
});

const env = {
  AGENT_WORKER_URL: 'https://agent.example.com/',
  AGENT_NOTIFY_SECRET: 'shared-secret',
} as unknown as Env;

const mention = makeComment({ mentions: [{ type: 'agent', id: AGENT_ID, name: 'Copy Editor' }] });

const ids = { site_id: SITE_ID, thread_id: THREAD_ID, comment_id: COMMENT_ID, agent_count: 1 };

function makeCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, settled: async () => { await Promise.all(pending); } };
}

const fetchMock = vi.fn();

beforeEach(() => {
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.debug.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function notify(): Promise<void> {
  const { ctx, settled } = makeCtx();
  notifyMentionedAgents(ctx, env, SITE_ID, mention);
  await settled();
}

describe('an unconfigured agent worker', () => {
  it('warns, so a deployed lane at LOG_LEVEL=info still sees it', async () => {
    const { ctx, settled } = makeCtx();
    notifyMentionedAgents(ctx, {} as Env, SITE_ID, mention);
    await settled();

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'agent mention not delivered: agent worker not configured',
      ids,
    );
  });
});

describe('the agent\'s verdict on a delivered mention', () => {
  it('reads a declined 202 as its own outcome rather than a delivery', async () => {
    fetchMock.mockResolvedValue(Response.json({ accepted: false, reason: 'not_addressed' }, { status: 202 }));
    await notify();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'agent mention declined',
      expect.objectContaining({ ...ids, accepted: false, reason: 'not_addressed' }),
    );
  });

  it('names a decline that arrived without a reason', async () => {
    fetchMock.mockResolvedValue(Response.json({ accepted: false }, { status: 202 }));
    await notify();

    expect(logger.warn).toHaveBeenCalledWith(
      'agent mention declined',
      expect.objectContaining({ accepted: false, reason: 'unspecified' }),
    );
  });

  it('records an accepted mention as delivered', async () => {
    fetchMock.mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    await notify();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'agent mention delivered',
      expect.objectContaining({ ...ids, accepted: true }),
    );
  });

  it('claims nothing about acceptance when the body does not say', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    await notify();

    const [, fields] = logger.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(logger.info).toHaveBeenCalledWith('agent mention delivered', expect.objectContaining(ids));
    expect(fields).not.toHaveProperty('accepted');
  });
});

describe('a body that never finishes arriving', () => {
  it('is a failed delivery, not a delivery with no verdict', async () => {
    const stalled = new Response('{', { status: 202 });
    vi.spyOn(stalled, 'json').mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));
    fetchMock.mockResolvedValue(stalled);
    await notify();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'agent mention delivery failed',
      expect.objectContaining({ 'error.type': 'TimeoutError' }),
    );
  });
});

describe('timing the delivery', () => {
  it('reports how long the hop took on every outcome', async () => {
    fetchMock.mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    await notify();
    expect(logger.info.mock.calls[0]?.[1]).toHaveProperty('duration_ms', expect.any(Number));

    logger.warn.mockReset();
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await notify();
    expect(logger.warn).toHaveBeenCalledWith(
      'agent mention delivery rejected',
      expect.objectContaining({ 'http.response.status_code': 500, duration_ms: expect.any(Number) }),
    );

    logger.warn.mockReset();
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await notify();
    expect(logger.warn).toHaveBeenCalledWith(
      'agent mention delivery failed',
      expect.objectContaining({ 'error.type': 'Error', reason: 'connection refused' }),
    );
  });
});

describe('trace context across the hop', () => {
  it('sends the caller\'s traceparent so both workers land in one trace', async () => {
    fetchMock.mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    const inbound = new Request('https://css.example.com/api/sites/x/threads', {
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    });

    const { ctx, settled } = makeCtx();
    withRequestContext(contextFromRequest(inbound), () => {
      notifyMentionedAgents(ctx, env, SITE_ID, mention);
    });
    await settled();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.traceparent).toContain('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(headers['X-Internal-Secret']).toBe('shared-secret');
  });

  it('sends no trace headers when there is no context to carry', async () => {
    fetchMock.mockResolvedValue(Response.json({ accepted: true }, { status: 202 }));
    await notify();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('traceparent');
  });
});
