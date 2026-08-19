---
name: logging
description: >-
  Emit, change, or review log output in this repo — the P1Logger from
  @pantheon-systems/p1-telemetry, not console.*. Use when adding or editing a log
  line, replacing console.log/warn/error, wiring a logger into a worker or app entry
  point, naming log fields, adding an allow-listed context field, propagating trace
  context across fetch or queue hops, or debugging why a field is missing from a log
  line. Also use when reviewing a diff that adds logging.
---

# Logging

`console.*` is not how this repo logs. `P1Logger` from `@pantheon-systems/p1-telemetry`
is — it stamps every line with service, env, `data_class`, trace/request ids, and runs
context through an allow-list that cannot be turned off.

Full reference: [packages/p1-telemetry/README.md](../../../packages/p1-telemetry/README.md).
Read it before wiring up a new consumer; this file is the decision layer.

## Where the logger belongs, and where it doesn't

| Code | Use |
|---|---|
| `workers/*` | `P1Logger`. |
| `apps/*` (server-side) | `P1Logger`. |
| `packages/*` (except `p1-telemetry` itself) | **Nothing.** Every other package is published. |
| Tests, `scripts/`, CLI output, dev tooling | `console` is fine — it is a program talking to its operator, not telemetry. |

The `packages/*` rule is a hard boundary, not a preference: a library that writes to a
customer's stdout is rude, and one that egresses telemetry fails a security review.
Published packages (`css-client`, `p1-next-sdk`, `puck-css`, `p1-media`,
`p1-content-validator`, `p1-ai-chat`, `create-p1-starter-kit`) propagate correlation
headers and accept an optional caller-supplied sink instead. Never add a
`p1-telemetry` dependency to one — that is an architecture change, not a logging change.

Note that `no-console` is **off** in the shared ESLint config, so lint will not catch a
stray `console.log` outside `p1-telemetry`. Reviewing for it is the control.

## Adoption is uneven — check before you assume

`workers/collaborative-state`, `workers/p1-agent`, and `workers/css-mcp-server` each have
a `src/telemetry.ts` exporting `ensureLogger(env)` — copy the nearest one. The
collaborative-state and p1-agent versions also cover the Durable Object case (a DO has its
own isolate, so it calls `ensureLogger` in its constructor).

Not yet wired: **`workers/p1-media`** (blocked on a `nodejs_compat` +
`compatibility_date` bump — p1-telemetry pulls in `node:async_hooks`; tracked in
PCC-3667) and **`apps/p1-starter`**. Both still use bare `console` in places.

So, when touching a file that logs:

- **Logger already initialized in this worker/app** → use it. Replacing nearby
  `console.*` in the file you're already editing is welcome. The three wired workers
  still have unconverted `console.*` call sites; converting them is in progress.
- **Not initialized yet** → wiring one up means an entry-point change, an `AppName`
  (`'css' | 'agent' | 'media' | 'mcp' | 'starter'`), env vars, and a flush call. That is
  its own task. Do it if it is the task; otherwise say so rather than half-adopting or
  quietly leaving a `console.log`.

## Writing a line

```ts
logger.info('publish complete', { site_id, 'http.response.status_code': 200 });
logger.warn('failed to load site origins', { reason: 'db unavailable', outcome: 'fail_open' });

const id = logger.error('publish failed', err, { status: 502 }); // returns the request id
logger.unhandled('uncaught', err); // global error boundary only
```

- `warn` means **degraded but served** — a fail-open path, a retry, a cache miss that
  mattered. Not "slightly interesting".
- `debug` accepts a thunk (`logger.debug('x', () => expensive())`) so a disabled level
  builds nothing.
- Pass the error as the second arg to `error()`; do not stringify it into `msg`.
- `logger.child({ site_id })` pre-binds fields. Never store request-scoped values on a
  module-level logger — one isolate serves concurrent requests.
- Trace id, request id, and route come from AsyncLocalStorage at emit time. Don't thread
  them through function signatures.

## Field names are a one-way door

Use an [OpenTelemetry semantic convention](https://opentelemetry.io/docs/specs/semconv/)
wherever one exists; our own name only where none does.

`http.request.method`, `http.response.status_code`, `http.route`, `db.operation.name`,
`error.type`, `server.address`, `gen_ai.request.model` — not `method`, `status`, `route`,
`operation`, `error_name`. Where no convention exists (`site_id`, `branch_id`,
`duration_ms`, `outcome`), use ours.

Once a dashboard or alert references a name, renaming it means migrating systems we don't
own. Getting this right at write time is cheaper than any later fix.

## Context is allow-listed, always

An unrecognized context key is dropped, with its *name* recorded in `context._dropped`.
There is no off switch in any environment — a local process can run against a staging or
production backend, so "local" logs can hold real customer content.

If a field you added isn't appearing, it was dropped. Add it to `ALLOWED_FIELDS`
([src/redact.ts](../../../packages/p1-telemetry/src/redact.ts)) or pass `allowFields` at
init — and only after confirming it can never carry customer content. To inspect a real
payload, use a debugger, not a log line.

## Crossing a boundary

```ts
await fetch(url, { headers: { ...init.headers, ...outboundHeaders() } });   // http
await queue.send({ ...payload, ...taskTraceFields() });                     // queues carry no headers
```

Consumers rebuild context with `contextForTask({ route, parentTraceId, parentSpanId, parentSampled })`.
Omitting `parentSampled` produces exactly the half-trace the flag exists to prevent.

Call `ctx.waitUntil(logger.flush())` at **every** entry point — `fetch`, `queue`,
`scheduled`, DO `fetch`, DO `alarm`.

## Reading logs locally

```bash
pnpm dev:logs
```

Then `pnpm logs:tail`, or query `.logs/current.ndjson` with `jq`. Dotted semconv keys
need bracket syntax: `jq -c 'select(.["http.route"]=="/api/sites/:id")'`. See the README
for more recipes.
