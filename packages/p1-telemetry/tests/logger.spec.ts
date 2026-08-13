import { context as otelContext, trace, TraceFlags } from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contextForTask,
  contextFromRequest,
  outboundHeaders,
  taskTraceFields,
  withRequestContext,
} from '../src/context.js';
import { getLogger, P1Logger, resetLoggerForTests, resolveDataClass } from '../src/logger.js';
import type { LogLine, Sink } from '../src/types/index.js';

function captureSink(): { sink: Sink; lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    sink: {
      id: 'capture',
      write: (line) => lines.push(line),
      flush: async () => undefined,
    },
  };
}

function makeLogger(overrides: Partial<Parameters<typeof P1Logger.create>[0]> = {}) {
  const { sink, lines } = captureSink();
  const logger = P1Logger.create({
    app: 'css',
    env: 'local',
    version: '1.2.3',
    runtime: 'worker',
    sinks: [sink],
    ...overrides,
  });
  return { logger, lines };
}

beforeEach(() => {
  resetLoggerForTests();
});

describe('P1Logger', () => {
  it('stamps every line with process identity', () => {
    const { logger, lines } = makeLogger();
    logger.info('hello');
    // Config keys stay camel/plain (`app`, `env`, `version`); the *emitted* names follow
    // OTel resource conventions.
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'hello',
      'service.name': 'css',
      'service.version': '1.2.3',
      'deployment.environment.name': 'local',
      runtime: 'worker',
    });
    expect(lines[0]?.run_id).toMatch(/^[0-9a-f]{8}$/);
    expect(typeof lines[0]?.ts).toBe('number');
  });

  it('increments seq so same-millisecond lines stay orderable', () => {
    const { logger, lines } = makeLogger();
    logger.info('one');
    logger.info('two');
    expect(lines[1]!.seq).toBeGreaterThan(lines[0]!.seq);
  });

  it('suppresses lines below minLevel and never evaluates a skipped thunk', () => {
    const { logger, lines } = makeLogger({ minLevel: 'warn' });
    const build = vi.fn(() => ({ site_id: 'abc' }));
    logger.debug('skipped', build);
    logger.info('also skipped');
    logger.warn('kept');
    expect(build).not.toHaveBeenCalled();
    expect(lines.map((l) => l.msg)).toEqual(['kept']);
  });

  it('reads request context from ALS rather than instance state', () => {
    const { logger, lines } = makeLogger();
    const request = new Request('https://example.com/api/sites/abc', {
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'x-p1-request-id': 'req-123',
        'x-p1-sdk': 'p1-next-sdk/0.8.0',
      },
    });
    const context = contextFromRequest(request, { route: '/api/sites/:id' });

    withRequestContext(context, () => logger.info('inside'));
    logger.info('outside');

    expect(lines[0]).toMatchObject({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      request_id: 'req-123',
      'http.route': '/api/sites/:id',
      sdk_name: 'p1-next-sdk',
      sdk_version: '0.8.0',
    });
    // No context outside the scope — and crucially no leakage of the previous request's ids.
    expect(lines[1]?.trace_id).toBeUndefined();
    expect(lines[1]?.request_id).toBeUndefined();
  });

  it('does not leak ids between concurrent contexts', async () => {
    const { logger, lines } = makeLogger();
    const contextFor = (id: string) =>
      contextFromRequest(new Request('https://example.com/', { headers: { 'x-p1-request-id': id } }));

    await Promise.all([
      withRequestContext(contextFor('req-a'), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.info('a');
      }),
      withRequestContext(contextFor('req-b'), async () => {
        logger.info('b');
      }),
    ]);

    const byMsg = new Map(lines.map((l) => [l.msg, l.request_id]));
    expect(byMsg.get('a')).toBe('req-a');
    expect(byMsg.get('b')).toBe('req-b');
  });

  it('binds fields via child() without mutating the parent', () => {
    const { logger, lines } = makeLogger();
    const scoped = logger.child({ site_id: 'site-1' });
    scoped.info('with binding', { duration_ms: 5 });
    logger.info('without binding');
    expect(lines[0]?.context).toEqual({ site_id: 'site-1', duration_ms: 5 });
    expect(lines[1]?.context).toBeUndefined();
  });

  it('redacts context fields, dropping names not on the allow-list', () => {
    const { logger, lines } = makeLogger();
    logger.info('page saved', { site_id: 'abc', page_title: 'Customer Secret' });
    expect(lines[0]?.context).toEqual({ site_id: 'abc', _dropped: ['page_title'] });
  });

  it('returns the request id from error() for echoing to the client', () => {
    const { logger } = makeLogger();
    const context = contextFromRequest(
      new Request('https://example.com/', { headers: { 'x-p1-request-id': 'req-xyz' } }),
    );
    const id = withRequestContext(context, () => logger.error('boom', new Error('nope')));
    expect(id).toBe('req-xyz');
  });

  it('marks boundary-reported errors as unhandled', () => {
    const { logger, lines } = makeLogger();
    logger.error('caught', new Error('a'));
    logger.unhandled('escaped', new Error('b'));
    expect(lines[0]?.unhandled).toBeUndefined();
    expect(lines[1]?.unhandled).toBe(true);
    expect(lines[1]?.err?.message).toBe('b');
  });

  it('survives a throwing sink without dropping other sinks', () => {
    const { sink: good, lines } = captureSink();
    const bad: Sink = {
      id: 'bad',
      write: () => {
        throw new Error('sink exploded');
      },
      flush: async () => {
        throw new Error('flush exploded');
      },
    };
    const logger = P1Logger.create({ app: 'css', env: 'local', sinks: [bad, good] });
    expect(() => logger.info('still logged')).not.toThrow();
    expect(lines).toHaveLength(1);
    return expect(logger.flush()).resolves.toBeUndefined();
  });

  it('registers a dev-only sink via addSink, affecting children too', () => {
    const { logger, lines } = makeLogger();
    const extra = captureSink();
    const scoped = logger.child({ site_id: 'x' });
    logger.addSink(extra.sink);
    scoped.info('fanned out');
    expect(lines).toHaveLength(1);
    expect(extra.lines).toHaveLength(1);
  });
});

describe('resolveDataClass', () => {
  it('treats loopback as local', () => {
    for (const url of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
      expect(resolveDataClass(url)).toBe('local');
    }
  });

  it('fails closed to remote for anything else, including unparseable input', () => {
    for (const url of [
      'https://css.pantheon.io',
      'not a url',
      '',
      undefined,
      'http://localhost.evil.com',
    ]) {
      expect(resolveDataClass(url)).toBe('remote');
    }
  });

  it('marks a local process pointed at a remote backend as handling customer content', () => {
    const { logger, lines } = makeLogger({
      env: 'local',
      backendUrl: 'https://css-staging.pantheon.io',
      dataClass: undefined,
    });
    logger.info('careful');
    expect(lines[0]?.['deployment.environment.name']).toBe('local');
    expect(lines[0]?.data_class).toBe('remote');
  });
});

describe('outboundHeaders', () => {
  it('propagates the trace with a fresh child span id', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          'x-p1-sdk': 'css-client/0.8.0',
        },
      }),
    );
    const headers = withRequestContext(context, () => outboundHeaders());
    expect(headers.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    expect(headers.traceparent).not.toContain('00f067aa0ba902b7');
    expect(headers['x-p1-request-id']).toBe(context.requestId);
    expect(headers['x-p1-sdk']).toBe('css-client/0.8.0');
  });

  it('returns nothing outside a request context', () => {
    expect(outboundHeaders()).toEqual({});
  });

  /**
   * `tracestate` is a caller's own vendor context. Dropping it silently breaks their
   * trace while leaving ours intact, which is the kind of bug nobody reports.
   */
  it('carries an inbound tracestate through the hop', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          tracestate: 'vendor=abc',
        },
      }),
    );
    const headers = withRequestContext(context, () => outboundHeaders());
    expect(headers.tracestate).toBe('vendor=abc');
  });
});

/**
 * The point of storing ids in an OTel `Context` rather than a private
 * `AsyncLocalStorage`: anything else in the process that asks OTel what the current
 * span is gets our trace, instead of starting an unrelated one.
 */
describe('OpenTelemetry interop', () => {
  it('exposes the request ids as the active span context', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      }),
    );

    const seen = withRequestContext(context, () => trace.getSpanContext(otelContext.active()));

    expect(seen?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(seen?.spanId).toBe(context.spanId);
    expect(seen?.traceFlags).toBe(TraceFlags.SAMPLED);
  });

  it('reports an unsampled trace as unsampled to OTel, not merely to us', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00' },
      }),
    );

    const seen = withRequestContext(context, () => trace.getSpanContext(otelContext.active()));

    expect(seen?.traceFlags).toBe(TraceFlags.NONE);
  });

  it('leaves no active span context once the request is over', () => {
    const context = contextFromRequest(new Request('https://example.com/'));
    withRequestContext(context, () => undefined);
    expect(trace.getSpanContext(otelContext.active())).toBeUndefined();
  });
});

describe('contextFromRequest', () => {
  it('mints ids when headers are absent', () => {
    const context = contextFromRequest(new Request('https://example.com/'));
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects oversized or unsafe inbound header values', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: {
          'x-p1-request-id': 'x'.repeat(200),
          'x-p1-sdk': 'bad;value',
          'x-p1-client-id': 'has space',
        },
      }),
    );
    // Falls back to a minted id rather than trusting the oversized one.
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // Punctuation and whitespace are refused: these values are echoed into log lines
    // and back onto outbound headers.
    expect(context.sdkName).toBeUndefined();
    expect(context.clientId).toBeUndefined();
  });
});

/**
 * `trace_id` alone gives correlated logs; reconstructing the call tree needs each hop to
 * name its parent. These pin the chain end to end, because the failure mode is a field
 * that looks present and points at nothing.
 */
describe('span parentage', () => {
  it('records the inbound span as the parent', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      }),
    );
    expect(context.parentSpanId).toBe('00f067aa0ba902b7');
    expect(context.spanId).not.toBe('00f067aa0ba902b7');
  });

  it('has no parent at the root of a trace', () => {
    expect(contextFromRequest(new Request('https://example.com/')).parentSpanId).toBeUndefined();
  });

  it('puts parent_span_id on the line only when there is a parent', () => {
    const { sink, lines } = captureSink();
    const logger = P1Logger.create({ app: 'css', env: 'local', sinks: [sink] });

    withRequestContext(
      contextFromRequest(
        new Request('https://example.com/', {
          headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
        }),
      ),
      () => logger.info('child'),
    );
    withRequestContext(contextFromRequest(new Request('https://example.com/')), () =>
      logger.info('root'),
    );

    expect(lines[0]?.parent_span_id).toBe('00f067aa0ba902b7');
    expect(lines[1]?.parent_span_id).toBeUndefined();
  });

  /** The whole point: what we send must be an id we also logged, or the tree breaks. */
  it('propagates our own span id, so the callee can point back at a line we emitted', () => {
    const { sink, lines } = captureSink();
    const logger = P1Logger.create({ app: 'css', env: 'local', sinks: [sink] });
    const context = contextFromRequest(new Request('https://example.com/'));

    const headers = withRequestContext(context, () => {
      logger.info('ours');
      return outboundHeaders();
    });

    const sentSpanId = /^00-[0-9a-f]{32}-([0-9a-f]{16})-\d{2}$/.exec(
      headers.traceparent ?? '',
    )?.[1];
    expect(sentSpanId).toBe(lines[0]?.span_id);
  });

  it('carries the enqueuing span through a queue payload', () => {
    const parent = contextFromRequest(new Request('https://example.com/'));
    const fields = withRequestContext(parent, () => taskTraceFields());

    const task = contextForTask({
      route: 'queue:rebuild',
      parentTraceId: fields.trace_id,
      parentSpanId: fields.span_id,
    });

    expect(task.traceId).toBe(parent.traceId);
    expect(task.parentSpanId).toBe(parent.spanId);
  });

  it('drops a parent span that belongs to a trace we did not continue', () => {
    const task = contextForTask({ route: 'queue:rebuild', parentSpanId: '00f067aa0ba902b7' });
    expect(task.parentSpanId).toBeUndefined();
  });
});

describe('sampling propagation', () => {
  /** No sampler here: an inbound decision is honored, never re-derived. */
  it('honors an inbound unsampled flag', () => {
    const context = contextFromRequest(
      new Request('https://example.com/', {
        headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00' },
      }),
    );
    expect(context.sampled).toBe(false);
    expect(withRequestContext(context, () => outboundHeaders()).traceparent).toMatch(/-00$/);
  });

  it('samples by default at the root', () => {
    expect(contextFromRequest(new Request('https://example.com/')).sampled).toBe(true);
    expect(contextForTask({ route: 'cron:x' }).sampled).toBe(true);
  });
});

describe('getLogger fallback', () => {
  /** Attributing an uninitialized process to a real service sends debugging elsewhere. */
  it('reports an unknown service rather than guessing one', () => {
    resetLoggerForTests();
    const { sink, lines } = captureSink();
    const logger = getLogger();
    logger.addSink(sink);
    logger.info('orphan');
    expect(lines[0]?.['service.name']).toBe('unknown');
  });
});
