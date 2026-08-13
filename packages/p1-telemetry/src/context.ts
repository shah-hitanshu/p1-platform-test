/**
 * Request-scoped telemetry context, held in the OpenTelemetry context API.
 *
 * A Worker isolate serves concurrent requests, so anything request-scoped must not live
 * in module scope or on a logger instance — it would be shared across overlapping
 * requests. That still holds; what changed is who owns the propagation.
 *
 * The store is `AsyncLocalStorageContextManager` rather than a bare `AsyncLocalStorage`
 * of our own. Same mechanism underneath, but the value it carries is an OTel `Context`,
 * which means the ids we mint are visible to `trace.getSpanContext(context.active())` —
 * so `W3CTraceContextPropagator` can inject them on outbound requests, and any
 * OTel-instrumented library in the process joins our trace instead of starting its own.
 *
 * Ids live in a `SpanContext`; the fields OTel has no concept of (`requestId`, the SDK
 * labels, the sink buffers) live under a context key alongside it.
 */

import {
  createContextKey,
  context as otelContext,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  type SpanContext,
  type TraceState,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  newSpanId,
  newTraceId,
  normalizeSpanId,
  normalizeTraceId,
  traceContextPropagator,
} from './trace-context.js';
import type { LogLine } from './types/index.js';

export interface RequestContext {
  traceId: string;
  spanId: string;
  /**
   * The span this work hangs off — the caller's, from the inbound `traceparent` or a
   * queue payload. Absent when we are the root of the trace.
   */
  parentSpanId?: string;
  sampled: boolean;
  tracestate?: TraceState;
  requestId: string;
  route?: string;
  /** Name half of `x-p1-sdk`, e.g. `p1-next-sdk`. */
  sdkName?: string;
  sdkVersion?: string;
  /** Caller-supplied app identifier from `x-p1-client-id`. */
  clientId?: string;
  /**
   * Per-sink line buffers, keyed by `Sink.id`. Async sinks batch here rather than in
   * module scope so concurrent requests cannot interleave, and so a buffer cannot
   * outlive the request whose `waitUntil` is meant to flush it.
   */
  buffers: Map<string, LogLine[]>;
}

const P1_CONTEXT_KEY = createContextKey('p1-telemetry/request');

/**
 * The context manager is global state, so registration is guarded and idempotent:
 * `setGlobalContextManager` returns false and logs if one is already installed, and a
 * host that has registered its own is deliberately left alone — ours would orphan
 * whatever context it was already carrying.
 */
let attempted = false;

export function installContextManager(): void {
  if (attempted) return;
  // Set before registering, not after: `setGlobalContextManager` returns false when a
  // manager is already installed, so keying the guard on success would retry — and
  // therefore allocate a manager and emit an OTel diagnostic — on every single request
  // in exactly the case we are trying to tolerate. A host that registered its own (a
  // Next.js app with its own OTel setup) already provides the storage we need.
  attempted = true;
  otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
}

export function currentContext(): RequestContext | undefined {
  return otelContext.active().getValue(P1_CONTEXT_KEY) as RequestContext | undefined;
}

/**
 * Run `fn` with `context` active. Everything emitted inside inherits its ids.
 *
 * Both representations are written from the same `RequestContext`, so the `SpanContext`
 * OTel sees and the object our logger reads cannot drift apart.
 */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  installContextManager();
  const active = otelContext
    .active()
    .setValue(P1_CONTEXT_KEY, context);
  return otelContext.with(trace.setSpanContext(active, toSpanContext(context)), fn);
}

function isSampled(flags: number): boolean {
  return (flags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
}

function toSpanContext(context: RequestContext): SpanContext {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    traceFlags: context.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    ...(context.tracestate ? { traceState: context.tracestate } : {}),
  };
}

export function bufferFor(context: RequestContext, sinkId: string): LogLine[] {
  const existing = context.buffers.get(sinkId);
  if (existing) return existing;
  const created: LogLine[] = [];
  context.buffers.set(sinkId, created);
  return created;
}

/** Lowercase because `Headers.get` is case-insensitive but our own lookups aren't. */
export const P1_TELEMETRY_HEADERS = {
  requestId: 'x-p1-request-id',
  sdk: 'x-p1-sdk',
  clientId: 'x-p1-client-id',
} as const;

/**
 * Caps for untrusted input. These headers come from arbitrary clients and are echoed
 * into log lines and onto outbound requests, so they're bounded and character-checked
 * before being stored. Correlation ids are debugging aids, never authorization claims.
 *
 * `traceparent`/`tracestate` are absent from this list on purpose — the propagator
 * validates those to the spec, which is stricter than anything here.
 */
const ID_MAX = 64;
const LABEL_MAX = 128;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
// No whitespace: a label like `p1-next-sdk/0.8.0` never needs it.
const SAFE_LABEL = /^[A-Za-z0-9._:/@-]+$/;

function safeHeader(value: string | null, max: number, pattern: RegExp): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return undefined;
  return pattern.test(trimmed) ? trimmed : undefined;
}

/** `p1-next-sdk/0.8.0` → name + version. A bare value is treated as a name. */
function parseSdkHeader(value: string | undefined): { name?: string; version?: string } {
  if (value === undefined) return {};
  const slash = value.lastIndexOf('/');
  if (slash <= 0 || slash === value.length - 1) return { name: value };
  return { name: value.slice(0, slash), version: value.slice(slash + 1) };
}

const headersGetter = {
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
  keys: (headers: Headers) => [...headers.keys()],
};

export interface ContextFromRequestOptions {
  /** Normalized low-cardinality route, e.g. `/api/sites/:id`. */
  route?: string;
  /** 0–1 trace sampling rate. Defaults to 1. */
  sampleRate?: number;
}

/**
 * Build a request context from inbound headers, minting whatever is missing. A
 * client-supplied trace id is honored so a customer's trace and ours line up; a
 * malformed one is discarded rather than propagated.
 */
export function contextFromRequest(
  request: Request,
  options: ContextFromRequestOptions = {},
): RequestContext {
  const parent = trace.getSpanContext(
    traceContextPropagator.extract(ROOT_CONTEXT, request.headers, headersGetter),
  );
  const traceId = parent?.traceId ?? newTraceId();
  const sdk = parseSdkHeader(
    safeHeader(request.headers.get(P1_TELEMETRY_HEADERS.sdk), LABEL_MAX, SAFE_LABEL),
  );

  return {
    traceId,
    // A new span for our own work; the inbound span is its parent.
    spanId: newSpanId(),
    parentSpanId: parent?.spanId,
    // Honored, not decided: there is no sampler here, and an inbound `false` is a
    // caller's own tracing decision that we have no business overriding.
    sampled: parent ? isSampled(parent.traceFlags) : true,
    tracestate: parent?.traceState,
    requestId:
      safeHeader(request.headers.get(P1_TELEMETRY_HEADERS.requestId), ID_MAX, SAFE_ID) ??
      crypto.randomUUID(),
    route: options.route,
    sdkName: sdk.name,
    sdkVersion: sdk.version,
    clientId: safeHeader(
      request.headers.get(P1_TELEMETRY_HEADERS.clientId),
      LABEL_MAX,
      SAFE_LABEL,
    ),
    buffers: new Map(),
  };
}

export interface ContextForTaskOptions {
  route: string;
  /** Trace of the request that enqueued this work; travels in the message body. */
  parentTraceId?: string;
  /** Span of the enqueuing request, so the task hangs off it in the call tree. */
  parentSpanId?: string;
  /**
   * The enqueuing request's sampling decision. Must travel with `parentTraceId` — a
   * task that flips an unsampled trace to sampled produces exactly the incoherent
   * half-trace the flag exists to prevent.
   */
  parentSampled?: boolean;
  requestId?: string;
}

/** Context for work with no inbound request — queue consumers, cron, DO alarms. */
export function contextForTask(options: ContextForTaskOptions): RequestContext {
  const parentTraceId = normalizeTraceId(options.parentTraceId);
  return {
    traceId: parentTraceId ?? newTraceId(),
    spanId: newSpanId(),
    // Only meaningful alongside the parent's trace. Without it we minted a fresh trace,
    // and a span id from someone else's would point at nothing.
    parentSpanId: parentTraceId === undefined ? undefined : normalizeSpanId(options.parentSpanId),
    sampled: options.parentSampled ?? true,
    requestId: options.requestId ?? crypto.randomUUID(),
    route: options.route,
    buffers: new Map(),
  };
}

const headersSetter = {
  set: (carrier: Record<string, string>, key: string, value: string) => {
    carrier[key] = value;
  },
};

/**
 * Headers for an outbound request so the trace survives the hop. Every
 * worker-to-worker call needs these, or the chain breaks where it's most interesting.
 *
 * The propagator injects *our own* span id, so the callee reports us as its parent and
 * the call tree reconstructs from `span_id` / `parent_span_id` across services.
 *
 * A fresh id per hop would be the more precise thing — one client span per outbound
 * call — but only once something records that span. Minting one here and not logging it
 * left the callee pointing at an id that appeared in no line we ever emitted.
 */
export function outboundHeaders(context = currentContext()): Record<string, string> {
  if (!context) return {};

  const headers: Record<string, string> = {
    [P1_TELEMETRY_HEADERS.requestId]: context.requestId,
  };
  traceContextPropagator.inject(
    trace.setSpanContext(ROOT_CONTEXT, toSpanContext(context)),
    headers,
    headersSetter,
  );
  if (context.sdkName) {
    headers[P1_TELEMETRY_HEADERS.sdk] = context.sdkVersion
      ? `${context.sdkName}/${context.sdkVersion}`
      : context.sdkName;
  }
  if (context.clientId) headers[P1_TELEMETRY_HEADERS.clientId] = context.clientId;
  return headers;
}

/**
 * Trace fields to embed in a queue message or DO alarm payload. Queues carry no
 * headers, so the context has to travel in the body.
 */
export function taskTraceFields(context = currentContext()): {
  trace_id?: string;
  span_id?: string;
  sampled?: boolean;
  request_id?: string;
} {
  if (!context) return {};
  return {
    trace_id: context.traceId,
    // The enqueuing span, so the consumer can record it as its parent — the queue
    // equivalent of what `traceparent` carries over HTTP.
    span_id: context.spanId,
    sampled: context.sampled,
    request_id: context.requestId,
  };
}
