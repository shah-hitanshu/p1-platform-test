# @pantheon-systems/p1-telemetry

Internal, unpublished. Structured logging, request context, and W3C trace context for the
workers.

## What is OpenTelemetry's and what is ours

Trace propagation, the context store, and attribute naming are OpenTelemetry's — there is no
reason to maintain a second implementation of a spec whose reference implementation is four
small packages:

| Concern | Owner |
|---|---|
| `traceparent` / `tracestate` parse, validate, serialize | `W3CTraceContextPropagator` (`@opentelemetry/core`) |
| Request-scoped storage | `AsyncLocalStorageContextManager` (`@opentelemetry/context-async-hooks`) |
| Span context, trace flags, id validation | `@opentelemetry/api` |
| Attribute names | OTel's names, our literals — see below |
| Log levels, redaction, sinks, line shape | ours |
| Trace/span **id minting** | ours — `crypto.getRandomValues`, where OTel's generator falls back to `Math.random` |
| Sampling decision | nobody's — the inbound flag is propagated, never re-derived |

### Why the attribute names are literals

`@opentelemetry/semantic-conventions` ships no `import` condition, so wrangler resolves its
CJS build, which esbuild cannot tree-shake. Importing the nineteen names we use pulls in all
264 KB of constants — **+59 KB gzipped in a Worker bundle**, measured with `wrangler deploy
--dry-run`. So production code writes the strings.

They are still checked, twice, at no runtime cost:

- `types/log-line.ts` `import type`s the constants as its interface keys. Type-only imports
  erase, and every literal written against `LogLine` becomes a compile error if it disagrees
  with upstream — `'service.nam'` fails `tsc`.
- `tests/semconv.spec.ts` imports the constants for real (test code is never bundled) and
  pins all nineteen, including the nine still `/incubating` where renames are permitted. An
  upstream rename fails CI instead of silently emitting a field no dashboard queries.

**No tracer provider is registered and no spans are created.** These are the propagation
primitives only. Deployed workers egress through `console` plus a tail consumer, not an
in-process exporter, and the JS *Logs* SDK is still "Development" status while traces and
metrics are stable.

### There is no sampler

`sampled` is propagated, not decided. An inbound `traceparent` flag is honored and passed
on; a trace we root defaults to sampled. Nothing here drops a line or skips work based on it.

A rate-based sampler lived here briefly and was removed: it computed a decision, wrote it
into the flag byte and queue payloads, and **no code ever read it back**. Carrying policy
that nothing enforces is worse than carrying none, because it reads like a guarantee. When
spans arrive, `ParentBased(TraceIdRatioBased)` from `@opentelemetry/sdk-trace-base` is the
replacement — a real sampler attached to a real thing to sample.

This adds three runtime dependencies (plus one dev-only) to a **private, workers-only**
package, costing **+16.5 KB gzipped** in a Worker bundle. It does not touch
[PLAN.md §2.2](../../docs/observability/PLAN.md), which constrains *published* packages —
`css-client` and `p1-next-sdk` still take `@opentelemetry/api` as an optional peer at most.

**Published SDK packages do not use this.** A library that writes to a customer's stdout is
rude, and one that egresses telemetry fails a security review. `css-client` and
`p1-next-sdk` propagate correlation headers and accept an optional caller-supplied sink;
they never log on their own.

## Using it

```ts
import { initLogger, contextFromRequest, withRequestContext, outboundHeaders } from '@pantheon-systems/p1-telemetry';

const logger = initLogger({
  app: 'css',
  env: env.ENVIRONMENT,
  version: env.APP_VERSION,
  backendUrl: env.CSS_BACKEND_URL, // derives data_class — see below
});

export default {
  async fetch(request, env, ctx) {
    const context = contextFromRequest(request, { route: '/api/sites/:id' });
    return withRequestContext(context, async () => {
      logger.info('request start', { method: request.method });
      try {
        return await handle(request);
      } finally {
        ctx.waitUntil(logger.flush());
      }
    });
  },
};
```

Everything request-scoped — trace id, request id, route — is read from the active
OpenTelemetry context at emit time, so you never pass it around. `logger.child({ site_id })`
pre-binds fields.

Because the ids live in an OTel `Context`, `trace.getSpanContext(context.active())` inside
that callback returns them: anything OTel-aware in the process joins the trace rather than
starting its own.

Levels are `debug` / `info` / `warn` / `error`, gated by one `minLevel` threshold. `warn` is
for *degraded but served* (a fail-open path, a retry) — the thing worth alerting on before
customers notice.

## Field naming

One rule: **use an OpenTelemetry [semantic convention](https://opentelemetry.io/docs/specs/semconv/)
wherever one exists, our own name where none does.** Field names are the one part of this
design that's a one-way door — once a dashboard or alert rule references a name, changing it
means migrating systems we don't own.

| Use | Not |
|---|---|
| `http.request.method`, `http.response.status_code`, `http.route` | `method`, `status`, `route` |
| `db.operation.name`, `db.collection.name`, `db.response.returned_rows` | `operation`, `table`, `row_count` |
| `error.type`, `server.address` | `error_name`, `url_host` |
| `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.tool.name` | `model`, `input_tokens`, `tool_name` |
| `site_id`, `branch_id`, `duration_ms`, `outcome`, … | — no convention exists, so nothing to conform to |

`duration_ms` is deliberately *not* `http.server.request.duration`: that convention is a
**metric** in seconds, and borrowing a metric name for a millisecond log field would be
worse than having our own.

The cost is `jq` ergonomics — `.["http.route"]` rather than `.route`. The recipes below are
written for it.

```ts
logger.warn('failed to load site origins', { reason: 'db unavailable', outcome: 'fail_open' });

// error() returns the request id, for echoing to the client
const id = logger.error('publish failed', err, { status: 502 });

// only from a global error boundary: nothing caught this
logger.unhandled('uncaught', err);
```

## Propagating

Every outbound hop needs the trace, or the chain breaks where it matters most:

```ts
await fetch(url, { headers: { ...init.headers, ...outboundHeaders() } });
```

Queues carry no headers, so trace context travels in the message body via
`taskTraceFields()`, and the consumer rebuilds it with `contextForTask()`:

```ts
await queue.send({ ...payload, ...taskTraceFields() });

// in the consumer
const context = contextForTask({
  route: 'queue:rebuild',
  parentTraceId: message.trace_id,
  parentSpanId: message.span_id,
  parentSampled: message.sampled,
});
```

`parentSpanId` is what hangs the task off its enqueuer in the call tree; it is ignored
unless `parentTraceId` came with it, since a span id from another trace points at nothing.
Pass `parentSampled` too — a task that flips an unsampled trace to sampled produces exactly
the half-trace the flag exists to prevent.

## Correlation, and its limits

Every line carries `trace_id`, `span_id`, and — when the work has a caller —
`parent_span_id`. `outboundHeaders()` injects our own span id, so a downstream service
records us as its parent and the tree reconstructs across services.

What this is not is per-hop timing. One span covers a whole request; there is no child span
per outbound call, because nothing creates or records spans yet. So the tree tells you who
called whom, not where the time went.

## Redaction

Allow-list only, and **not switchable off in any environment**. An unrecognized context key
is dropped and its *name* recorded in `context._dropped`, so a missing field is debuggable
without becoming the leak it prevented.

```ts
logger.info('publish', { site_id: 'abc', page_title: 'Customer Private Page' });
// → context: { site_id: 'abc', _dropped: ['page_title'] }
```

Extend with `allowFields` at init. There is no removal and no off switch: a local process
can run against a staging or production backend (`pnpm dev:starter:staging` does exactly
that), so "local" logs can hold real customer content. To inspect a real payload, use a
debugger.

`data_class` is derived from the **backend host**, not the env lane, and fails closed to
`remote` when the host can't be resolved — so a local-but-pointed-at-prod session is
visibly handling customer content:

```sh
jq -c 'select(.data_class=="remote")' .logs/current.ndjson   # did this run touch real data?
```

## Local ndjson logs

Worker code has no filesystem access, so a collector process owns the file and every
runtime POSTs to it. That's also what puts all the workers into one interleaved stream.

```sh
pnpm dev:logs                                          # collector on 127.0.0.1:8799
pnpm logs:tail                                         # live, human-readable
jq -c 'select(.trace_id=="…")' .logs/current.ndjson    # one causal chain, sorted by (ts, seq)
jq -c 'select(.level=="error")' .logs/current.ndjson

# dotted semconv keys need bracket syntax
jq -c 'select(.["http.route"]=="/api/sites/:id")' .logs/current.ndjson
jq -c 'select(.context["db.operation.name"]=="select") | .context' .logs/current.ndjson
```

Set `P1_LOG_SINK=http://127.0.0.1:8799` for a worker to use it. The collector binds to
loopback only, guarantees every line in the file parses, and degrades silently when it
isn't running — a missing collector means console-only, not a broken dev loop.

## Where logs end up in production

Deployed workers write JSON to `console`; nothing in this package ships telemetry anywhere.
Cloudflare Workers Logs indexes the JSON fields, so `trace_id`, `request_id`, `site_id` and
`route` are filterable dimensions in the Cloudflare dashboard for **7 days** (paid plan).

That's why the console sink passes a single **object** to `console.*` rather than a
pre-stringified line — stringifying would leave Cloudflare nothing to index and put you back
to substring search. It's load-bearing, not stylistic.

Longer retention, alerting, and joins with non-Cloudflare telemetry need Pantheon's Grafana,
which is a separate transport still being worked out with PIE. See
[`docs/observability/PLAN.md`](../../docs/observability/PLAN.md).
