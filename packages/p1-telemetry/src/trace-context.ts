/**
 * W3C Trace Context, via OpenTelemetry.
 *
 * Parsing, validation, and serialization of `traceparent`/`tracestate` are
 * `W3CTraceContextPropagator`'s job now. It is the reference implementation of the spec
 * we were reimplementing, it is already a peer of everything else in this package, and
 * it gets three things right that the hand-rolled parser did not:
 *
 * - **Future versions are accepted.** The spec guarantees a higher `version` keeps the
 *   first three fields compatible, precisely so receivers can parse them; rejecting
 *   `01-…` meant dropping a trace that a spec-compliant caller was entitled to continue.
 * - **`tracestate` is parsed, not pattern-matched.** Invalid entries are dropped and the
 *   list is capped at 32, so header injection is impossible by construction rather than
 *   by a printable-ASCII regex.
 * - **Case and whitespace are strict**, as the spec requires. The old parser lowercased
 *   and trimmed, silently accepting headers a conformant peer would reject — and so
 *   disagreeing with every other participant about whether the trace continued.
 *
 * @see https://www.w3.org/TR/trace-context/
 */

import {
  isValidSpanId as otelIsValidSpanId,
  isValidTraceId as otelIsValidTraceId,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/** Stateless; one instance is enough and avoids re-allocating per request. */
export const traceContextPropagator = new W3CTraceContextPropagator();

/**
 * Id minting stays ours. OTel's `RandomIdGenerator` lives in `sdk-trace-base`, which
 * this package deliberately does not depend on, and it falls back to `Math.random` —
 * `crypto.getRandomValues` is available in every runtime we target and is the better
 * source regardless.
 */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const byte of buf) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function newTraceId(): string {
  return randomHex(16);
}

export function newSpanId(): string {
  return randomHex(8);
}

/**
 * True for a well-formed, non-zero trace id. Used when a trace id travels outside a
 * header — a queue message body, a DO alarm payload — where no propagator has vetted it.
 */
export function isValidTraceId(value: string | null | undefined): value is string {
  return typeof value === 'string' && otelIsValidTraceId(value);
}

/**
 * OTel's validator accepts uppercase hex, but ids are emitted lowercase and log
 * backends match them literally. Normalizing on ingest keeps a trace from splitting in
 * two because one producer shouted.
 */
export function normalizeTraceId(value: string | null | undefined): string | undefined {
  return isValidTraceId(value) ? value.toLowerCase() : undefined;
}

/** As `normalizeTraceId`, for a span id arriving in a queue message or alarm payload. */
export function normalizeSpanId(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && otelIsValidSpanId(value) ? value.toLowerCase() : undefined;
}
