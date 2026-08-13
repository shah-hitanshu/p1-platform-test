import { ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import {
  isValidTraceId,
  newSpanId,
  newTraceId,
  normalizeTraceId,
  traceContextPropagator,
} from '../src/trace-context.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

const getter = {
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
  keys: (headers: Headers) => [...headers.keys()],
};

function extract(headers: Record<string, string>) {
  return trace.getSpanContext(
    traceContextPropagator.extract(ROOT_CONTEXT, new Headers(headers), getter),
  );
}

/**
 * These assert the *contract we depend on*, not the propagator's internals — this is
 * the boundary where a behavior change in an upstream dependency would silently break
 * trace continuity, so it's worth pinning.
 */
describe('traceparent extraction', () => {
  it('continues a valid sampled trace', () => {
    const parent = extract({ traceparent: `00-${TRACE}-${SPAN}-01` });
    expect(parent?.traceId).toBe(TRACE);
    expect(parent?.spanId).toBe(SPAN);
    expect(parent?.traceFlags).toBe(TraceFlags.SAMPLED);
  });

  it('reads an unsampled flag rather than assuming sampled', () => {
    expect(extract({ traceparent: `00-${TRACE}-${SPAN}-00` })?.traceFlags).toBe(TraceFlags.NONE);
  });

  it('accepts a future version, since the spec fixes the first three fields', () => {
    expect(extract({ traceparent: `01-${TRACE}-${SPAN}-01-future` })?.traceId).toBe(TRACE);
  });

  /** `Headers` strips padding from a value, so the propagator never sees it. */
  it('tolerates a padded header value, which the platform trims first', () => {
    expect(extract({ traceparent: `  00-${TRACE}-${SPAN}-01  ` })?.traceId).toBe(TRACE);
  });

  it('discards malformed input rather than propagating garbage', () => {
    for (const bad of [
      '',
      'garbage',
      `ff-${TRACE}-${SPAN}-01`, // ff is reserved, not a future version
      `00-${TRACE}-${SPAN}`, // missing flags
      `00-${TRACE.slice(0, 30)}-${SPAN}-01`, // short trace id
      `00-${'0'.repeat(32)}-${SPAN}-01`, // all-zero trace id
      `00-${TRACE}-${'0'.repeat(16)}-01`, // all-zero span id
      `00-${TRACE}-${SPAN}-01; DROP TABLE`, // injection-shaped suffix
      `00-${TRACE.toUpperCase()}-${SPAN}-01`, // hex is lowercase-only
    ]) {
      expect(extract({ traceparent: bad })).toBeUndefined();
    }
  });
});

describe('tracestate', () => {
  it('carries a vendor value through the hop', () => {
    const parent = extract({
      traceparent: `00-${TRACE}-${SPAN}-01`,
      tracestate: 'vendor=abc,other=def',
    });
    expect(parent?.traceState?.get('vendor')).toBe('abc');
  });

  /**
   * The value is re-emitted on outbound requests, so this is the header-injection
   * guard. Structural parsing, not a character regex: an unparseable entry is dropped
   * and the rest of the list survives.
   *
   * Uses a plain-object carrier deliberately — a real `Headers` rejects a newline value
   * at construction, which would test the runtime rather than the layer we depend on.
   */
  it('drops entries it cannot parse instead of echoing them', () => {
    const parent = trace.getSpanContext(
      traceContextPropagator.extract(
        ROOT_CONTEXT,
        {
          traceparent: `00-${TRACE}-${SPAN}-01`,
          tracestate: 'bad\nheader: injected,good=1',
        },
        {
          get: (carrier: Record<string, string>, key: string) => carrier[key],
          keys: (carrier: Record<string, string>) => Object.keys(carrier),
        },
      ),
    );
    expect(parent?.traceState?.serialize()).toBe('good=1');
  });

  it('caps the list at the spec maximum of 32 entries', () => {
    const parent = extract({
      traceparent: `00-${TRACE}-${SPAN}-01`,
      tracestate: Array.from({ length: 40 }, (_, i) => `k${i}=v`).join(','),
    });
    expect(parent?.traceState?.serialize().split(',')).toHaveLength(32);
  });
});

describe('id minting', () => {
  it('mints valid, unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTraceId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isValidTraceId(id)).toBe(true);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects an all-zero or malformed trace id', () => {
    expect(isValidTraceId('0'.repeat(32))).toBe(false);
    expect(isValidTraceId('nope')).toBe(false);
    expect(isValidTraceId(undefined)).toBe(false);
  });
});

describe('normalizeTraceId', () => {
  /** Ids arriving in a queue body are not vetted by any propagator. */
  it('lowercases, so a shouted id still joins its trace', () => {
    expect(normalizeTraceId(TRACE.toUpperCase())).toBe(TRACE);
  });

  it('returns undefined for anything unusable', () => {
    expect(normalizeTraceId('0'.repeat(32))).toBeUndefined();
    expect(normalizeTraceId('nope')).toBeUndefined();
    expect(normalizeTraceId(undefined)).toBeUndefined();
  });
});
