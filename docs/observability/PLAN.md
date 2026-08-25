# Observability Plan

**Status:** Draft
**Supersedes:** `docs/ccr/MONITORING-PLAN.md` (Jan 2026, never approved; its metrics service shipped
partially — see [Current state](#1-current-state))
**Scope:** logs, metrics, and traces for the workers, the DB, the published SDK packages, and the
MCP/AI surface. Destination is Pantheon's Grafana Cloud (`pantheon.grafana.net`).

---

## Contents

1. [Current state](#1-current-state)
2. [Principles](#2-principles) — the rule that shapes everything else
3. [OTLP vs Loki vs the rest](#3-otlp-vs-loki-vs-the-rest)
4. [Correlation: SDK → worker → worker → DB](#4-correlation-sdk--worker--worker--db)
5. [Packages and code to add](#5-packages-and-code-to-add)
6. [Instrumentation seams](#6-instrumentation-seams)
7. [Profiling the MCP / AI surface](#7-profiling-the-mcp--ai-surface)
8. [Cardinality, PII, and cost rules](#8-cardinality-pii-and-cost-rules)
9. [Phases](#9-phases)
10. [Decisions needed](#10-decisions-needed)

---

## 1. Current state

| Area | What exists |
|---|---|
| Worker logs | Cloudflare Workers Logs on in ccr, media, mcp-server (`observability.logs`); `p1-agent` has bare `observability.enabled`. Unstructured `console.*` with ad-hoc prefixes (`[cors]`, `[auth]`, `[fetch]`). Short retention, Cloudflare dashboard only. |
| Worker metrics | `workers/ccr/src/services/metrics-service.ts` — request-scoped buffer, counters/timers/gauges, flush in a `finally`. Instrumented at `index.ts:150-172` (HTTP), `middleware/health.ts`, `durable-objects/websocket-connection-manager.ts`, `durable-objects/alarm-cleanup-manager.ts`. |
| …but | `METRICS_ENABLED: "true"` in staging and production (`wrangler.jsonc:152,233`) while `METRICS_PUSH_ENDPOINT` is set nowhere in the repo → `flushMetrics()` clears the buffer and returns (`metrics-service.ts:195-199`). Even wired up, the payload is `{"metrics":[…]}` + Bearer, which is not a protocol Grafana Cloud accepts (no remote-write, no OTLP). **Today: zero metrics leave the worker.** |
| Traces | None. |
| DB | `postgres` 3.4.8 via `runSqlUnsafe()` (`db.ts:204`), one connection per request through `runWithConnection()` + `AsyncLocalStorage` (`db.ts:65-76`). Hyperdrive in staging/prod. No query timing, no correlation to the request. |
| Worker→worker | No context propagation. `p1-agent`'s `CcrApiClient` (`css-api.ts:237`) builds fresh `fetch` inits. |
| SDK packages | `@pantheon-systems/p1-next-sdk`, `css-client`, `p1-ai-chat`, `p1-media` — zero telemetry. Every backend call funnels through one method: `BaseEndpoint.request()` (`packages/css-client/src/endpoints/base.ts:68`). It sends `X-API-Key`/`Authorization`, `X-Principal-Id`, `X-Principal-Type`, `X-Agent-Session-Id`. No request id, no trace context, no SDK version. |
| MCP / AI | `ccr-mcp-server` registers every tool through one loop (`mcp-handler.ts:140`). `p1-agent` normalizes both providers behind `ModelTransport` with a `CompletionUsage` shape already carrying cache-token fields (`model.ts:36`, `anthropic.ts:164`). All model calls go through Cloudflare AI Gateway (`cf-aig-gateway-id`, `model.ts:87`). None of it is measured. |

---

## 2. Principles

### 2.1 The SDK never egresses telemetry

`p1-next-sdk` and `css-client` run in **customer** Next.js apps on **customer** infrastructure. A
published npm package that phones home is a package that fails a security review — it collects data
from a third party's production without consent, and it ships a Grafana credential in a public
tarball.

So the split is:

- **The SDK propagates and identifies.** It attaches correlation headers and its own version. That's
  it. No network egress, no credential, no buffering, no background flush.
- **The backend exports.** The workers we operate turn those headers into logs, metrics, and traces.
- **Client-side telemetry is an opt-in hook**, wired by the customer to *their* observability stack.

The useful consequence: nearly everything we want to know about SDK adoption — which versions are in
the field, which endpoints customers actually call, what's slow, what errors — is derivable
server-side from headers. No client collection at all.

### 2.2 Zero new runtime dependencies in published packages

`css-client` reaches the browser (via `p1-ai-chat` / `puck-css`). Header propagation costs ~0 bytes.
`@opentelemetry/api` costs real bytes. It goes in as an *optional peer dependency* on the SDK side,
never a hard dep, and never on the default path.

### 2.3 One id, echoed back

Every response carries `x-p1-request-id`, and every thrown `P1ApiError` includes it in its message. A
customer pastes an id into a support ticket; we run `{request_id="…"}` in Loki and see the whole
server-side story. This is the single highest-leverage change in the plan and it depends on nothing
else.

### 2.4 Structured before shipped

A JSON log line with `trace_id`/`request_id`/`route` is worth having even if it never leaves
`wrangler tail`. Phase 1 delivers value with no Grafana dependency at all.

---

## 3. OTLP vs Loki vs the rest

These get conflated constantly. They sit at different layers.

**Signals** — the three kinds of data:

| Signal | Question it answers | Shape | Volume |
|---|---|---|---|
| **Metrics** | "Is p99 latency up? How many 5xx in the last hour?" | Numeric time series with low-cardinality labels | Tiny, aggregated |
| **Logs** | "What happened on *this* request?" | Timestamped records with arbitrary fields | Large, per-event |
| **Traces** | "Where did those 900ms go, across which services?" | Tree of spans, each with a parent | Medium, sampled |

**Backends** — Grafana Cloud is three databases behind one UI:

| Backend | Stores | Query language |
|---|---|---|
| **Mimir** (Prometheus-compatible) | metrics | PromQL |
| **Loki** | logs | LogQL |
| **Tempo** | traces | TraceQL |

**Protocols** — how bytes get from us to them:

| Protocol | What it is | Which signals | Who accepts it |
|---|---|---|---|
| **OTLP** | OpenTelemetry's own wire protocol. Vendor-neutral, carries **all three** signals over HTTP (protobuf or JSON) or gRPC. | metrics, logs, traces | Grafana Cloud's OTLP gateway, which fans out to Mimir/Loki/Tempo. Also every other APM vendor. |
| **Loki push API** | Loki's native `POST /loki/api/v1/push`. Log-specific: streams of `{labels} → [[ts, line], …]`. | logs only | Loki only |
| **Prometheus remote write** | Mimir's native ingest. Protobuf + snappy. | metrics only | Mimir / Prometheus only |

So "OTLP vs Loki" is really **one vendor-neutral pipe for everything** vs **a signal-specific native
pipe**. The tradeoffs:

- **OTLP** is one endpoint, one credential, one mental model, and it's the only protocol that gets
  you *traces*. It's also how you'd move off Grafana without rewriting instrumentation. Cost: you
  emit OTLP-shaped payloads, so a hand-rolled exporter has real structure to get right, and the
  official SDK is heavy for a Worker bundle.
- **Loki's push API** is trivially simple — JSON, labels plus lines, done. For logs specifically,
  from a Cloudflare tail consumer, it's less code than OTLP-logs and easier to debug.

### 3.1 Pantheon platform constraints (decided 2026-08-07)

**None of the above can be used directly.** PIE (`#team-pie-collab`) owns Grafana, and the governing
rule from Max Mena is that no application ships anything to Grafana Cloud itself — everything lands
via a PIE-managed Alloy collector, to avoid credential and config sprawl. Alert rules live as YAML in
the `grafana-alerts` module in `gke-terraform`. Onboarding docs are in `gke-terraform`, not Confluence.

The three supported ingest paths (Prometheus scrape, OTLP push, GCP-primitive pull) all authenticate
a **Google identity** — a Cloud Run service account or GKE Workload Identity. A Cloudflare Worker has
neither, so none of them applies to us as written.

Asked directly, PIE's answer was:

> "I'm very hesitant to open the logs ingestor publicly, unless you guys wanted to build something
> like logstash and host it in our GCP, and it can then forward logs to our collectors" — and,
> separately, "unless we have an option to dump the cloudflare logs to Pubsub".

So: **a public ingest endpoint is refused; a self-hosted forwarder in Pantheon GCP is pre-approved;
Pub/Sub is the preferred seam** (which also tells us they run Alloy's `loki.source.gcplog`, since
that consumes Pub/Sub).

Two dead ends worth recording so they aren't re-derived:

- **Direct Loki push or direct OTLP from a Worker** — forbidden by policy, and the OTLP receiver
  additionally needs a Google-signed OIDC token a Worker can't mint.
- **Logpush → GCS → Alloy** — a GCS object-create notification carries object *metadata*, not the log
  lines inside the object, so Alloy would receive "a file appeared". Something still has to read the
  object and publish its contents.

### 3.2 Near-term: Cloudflare Workers Logs

Until a forwarder exists, deployed workers write structured JSON to `console` and stop there.
Cloudflare Workers Logs indexes the JSON fields and makes them filterable with unlimited
cardinality, so `trace_id`, `request_id`, `site_id`, and `http.route` are queryable dimensions in the
Cloudflare dashboard — **7 days retention on paid, 3 on free** (5B logs/account/day ceiling).

This is why the console sink passes a single **object** to `console.*` rather than a pre-stringified
line: stringifying leaves Cloudflare nothing to index and reverts you to substring search.

It covers correlation and triage. It does **not** cover retention beyond 7 days, alerting (Workers
Logs can't page anyone), or joining with non-Cloudflare telemetry. Those three are the entire
remaining justification for the Grafana work, and none is urgent — so the forwarder waits for one of
them to actually bite, most likely alerting, and most likely in the form of metrics rather than logs.

### 3.3 Eventual shape

```
producers (ccr, agent, media, mcp — incl. their DOs)
      │  console.* → structured JSON
      ▼
p1-tail-worker            (a Worker with a tail() handler — not a Durable Object)
      │  batched ndjson over HTTPS   ← we own this hop's auth, and its exposure
      ▼
forwarder on Cloud Run    (GSA → therefore an OIDC identity)
      ├── logs ────→ Pub/Sub ──→ PIE Alloy (loki.source.gcplog) ──→ Loki
      └── metrics ─→ Alloy :4321, Bearer Google ID token ──→ Mimir
                     (our GSA allowlisted in otlp_jwt_allowed_emails)
```

Note the fork: `grafana-alloy-otlp` is documented for **metrics**; logs go via Pub/Sub. And note the
cost that's easy to under-build — PIE's caution about a public log ingestor doesn't disappear here,
it **transfers to us**, since Cloudflare must reach the forwarder from outside Pantheon's network.
Auth, rate limiting, payload caps, and schema validation become our responsibility.

Open with PIE: whether a Cloudflare path is on their roadmap (P1 won't be the last non-GCP workload),
whether anyone already runs such a forwarder, whether metrics-only is a sensible first step, and
whether traces have any path today.

---

## 4. Correlation: SDK → worker → worker → DB

### 4.1 The wire contract

Four headers, added in `BaseEndpoint.request()` (`packages/css-client/src/endpoints/base.ts:70`):

| Header | Value | Purpose |
|---|---|---|
| `traceparent` | W3C Trace Context: `00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>`. Continued from an ambient OTel span if one exists, else minted. | The standard. Free correlation across Loki/Tempo/Mimir and with any customer-side OTel setup. |
| `x-p1-request-id` | One id per logical SDK call (`crypto.randomUUID()` — no dep needed in Node 19+, browsers, or Workers) | Human-quotable. Survives in error messages and support tickets. |
| `x-p1-sdk` | `p1-next-sdk/0.8.0` (and `css-client/0.8.0` when used directly) | Version adoption in the field. This *is* the SDK analytics. |
| `x-p1-client` | Optional caller-supplied app/site identifier | Segment by customer with no PII. |

Also add `tracestate` pass-through if present — cheap, and it's what makes a customer's own vendor
context survive the hop.

**Response side:** echo `x-p1-request-id` on every response (success and error), and include it in
`P1ApiError` messages (`packages/css-client/src/errors.ts`).

### 4.2 Server side: a request context

At the worker edge (`workers/ccr/src/index.ts:67`), before routing:

1. Parse inbound `traceparent`. If absent or malformed, mint a new trace id.
2. Parse `x-p1-request-id`; mint if absent.
3. Read `x-p1-sdk`, `x-p1-client`.
4. Stash all of it in an `AsyncLocalStorage` **alongside the DB connection** — the pattern already
   exists in `runWithConnection()` (`db.ts:76`), so this is a second store or a widened value, not a
   new mechanism.
5. Emit one structured line per request: `trace_id`, `span_id`, `request_id`, `sdk`, `client`, `env`,
   `version`, `method`, `route_pattern` (reuse `normalizePathPattern()` — it already exists and is
   already right, emitted as `http.route`), `http.response.status_code`, `duration_ms`, plus `cf_ray`
   and `colo` from the CF object. Field names follow OTel semantic conventions wherever one
   exists — see the package README.

**Security note.** `stripInboundTrustedHeaders()` (`index.ts:84`) deliberately drops client-supplied
identity headers so they can never reach a Durable Object. The `x-p1-*` correlation headers must sit
**outside** that trusted set. A client-supplied trace id is fine — it's a debugging aid, not an authz
claim — but it must never be treated as authenticated, and it must never be interpolated anywhere
without length/charset validation (32 hex, 16 hex).

### 4.3 Worker → worker

`traceparent` must be forwarded on every outbound hop or the chain breaks exactly where it's most
interesting:

- `p1-agent` → ccr: `CcrApiClient.request()` (`workers/p1-agent/src/css-api.ts:237`) and
  `validateCCRToken()` (`auth.ts:5`)
- `p1-agent` → tools' outbound fetches (`tools.ts:477`, `tools.ts:490`)
- ccr → media, ccr → DO fetches, ccr → queue messages (put the trace context in the message body —
  queues don't carry headers)
- `ccr-mcp-server` → ccr via its injected `fetcher` (`mcp-handler.ts` config)

Each hop mints a child span id and passes the same trace id.

### 4.4 Worker → DB

Two levels, and the second one has a trap worth knowing about.

**Level 1 — app-side spans (do this).** Wrap `runSqlUnsafe()` (`db.ts:204`). It is the single
chokepoint for every query in the system, including inside transactions (`db.ts:185`). Emit per
query: `duration_ms`, `rowCount`, operation + primary table (parsed from the statement, or better,
passed in as a label by callers over time), whether it went through Hyperdrive, and whether the
20-second race timed out. Never log parameters. This gets you "which queries are slow on this trace"
without touching Postgres at all.

Also set `application_name` on the connection (`postgres()` options at `db.ts:146`) to something like
`ccr-worker/<env>/<version>`. It shows up in `pg_stat_activity` and Cloud SQL logs, and it's
low-cardinality and safe.

**Level 2 — sqlcommenter (do this carefully).** The usual trick for joining application traces to
database-side observability is to append a comment to the SQL:

```sql
SELECT … /*traceparent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'*/
```

Postgres ignores it; it shows up in `pg_stat_activity.query` and in slow-query logs, letting you take
a slow statement in the DB and jump to the trace that caused it.

**Two caveats that matter for us specifically:**

1. **It defeats Hyperdrive's query caching.** Hyperdrive caches by query text; a per-request unique
   comment makes every query textually unique and turns the cache hit rate to zero. That is a real
   latency and cost regression, not a theoretical one.
2. **It pollutes `pg_stat_statements`.** The comment rides along in the stored query text.

So: **do not inject a per-request comment on the default path.** Inject only when the request is
sampled for deep tracing (a debug header on an internal-authenticated route, or a low-percentage
sample on non-Hyperdrive/admin connections), and keep an always-on *low-cardinality* comment instead
— `/*route='/api/sites/:id/documents',env='prod'*/` — which is stable enough not to fragment the
cache while still grouping DB-side stats by route.

For everyday work, level 1 is what you'll actually use.

---

## 5. Packages and code to add

### 5.1 New internal package: `packages/p1-telemetry`

Private (`"private": true`) workspace package, consumed by the workers via `workspace:*`. This is
where the non-obvious logic lives exactly once:

| Module | Contents |
|---|---|
| `trace-context.ts` | `W3CTraceContextPropagator` for `traceparent`/`tracestate`; mints trace/span ids from `crypto.getRandomValues` |
| `context.ts` | OTel-`Context`-backed request context (via `AsyncLocalStorageContextManager`): ids, sdk, env, version, route; `withRequestContext()`, `currentContext()` |
| `log.ts` | `log.debug/info/warn/error(msg, fields)` → single-line JSON on stdout/stderr, context fields merged automatically |
| `redact.ts` | Allow-list field redaction; token/JWT/email patterns scrubbed |
| `metrics.ts` | The existing counter/timer/gauge API, lifted from `metrics-service.ts` |
| `otlp.ts` | Minimal OTLP/HTTP **JSON** encoder + `fetch` exporter for metrics and spans |
| `span.ts` | Tiny span helper (`startSpan`/`end`, attributes, status) — enough for our own instrumentation without pulling in the OTel SDK |

**What OpenTelemetry owns here.** Trace propagation (`W3CTraceContextPropagator`), the context store
(`AsyncLocalStorageContextManager`), span-context types, and attribute names all come from the OTel
packages — reimplementing a spec whose reference implementation is four small dependencies bought
nothing but our own bugs, and the hand-rolled parser had three: it rejected future `traceparent`
versions the spec entitles a caller to send, pattern-matched `tracestate` instead of parsing it, and
accepted padded/uppercased headers a conformant peer would refuse.

What stays ours: the log pipeline (levels, redaction, sinks, line shape), because the JS **Logs** SDK
is still "Development" status while traces and metrics are stable, and because deployed workers
egress through `console` + tail consumer rather than an in-process exporter; and id minting, since
OTel's generator falls back to `Math.random`.

**No tracer provider is registered and no spans are created yet**, and correspondingly there is no
sampler. A rate-based `sampling.ts` briefly lived here and was removed in review: it computed a
decision, propagated it in the flag byte and in queue payloads, and nothing ever read it back. Policy
that nothing enforces is worse than none, because it reads like a guarantee. The inbound flag is
honored and forwarded; `ParentBased(TraceIdRatioBased)` returns with spans, attached to something
real to sample.

#### Measured bundle cost

The original "bundle size in a Worker" objection was never measured. It is now, via
`wrangler deploy --dry-run` on a minimal worker (`nodejs_compat`, wrangler 4.120.1), gzipped:

| Variant | gzip | Δ baseline |
|---|---|---|
| Bare worker | 5.33 KB | — |
| `api` + `core` + `context-async-hooks` | 21.79 KB | **+16.5 KB** |
| …plus importing `semantic-conventions` | 80.42 KB | +75.1 KB |
| …plus `sdk-trace-base` (provider, sampler, span exporter) | 52.21 KB | **+46.9 KB** |

Two conclusions. First, `semantic-conventions` must not be imported in bundled code: it ships no
`import` condition, so wrangler takes the untree-shakeable CJS build and inlines all 264 KB of
constants — **+59 KB for nineteen strings**. The names are written as literals and pinned by a
type-only import plus `semconv.spec.ts`.

Second, the size objection to the tracing SDK does not survive contact with the numbers: **+30 KB
gzipped** over the primitives, against a 3 MB (free) / 10 MB (paid) compressed Worker limit. If spans
are declined it should be on the grounds that there is nowhere to send them yet, not on size.

The proposed shape, if adopted: a `BasicTracerProvider` with `ParentBased(TraceIdRatioBased)` — the
sampler that replaces the one removed in review — plus a `SpanExporter` that writes each span as a JSON line to the existing
console sink, so the tail consumer carries spans alongside logs and converting them to OTLP for Tempo
later is a change in `p1-tail` rather than in every worker. No new egress path, no new credential, and
it does not depend on the §10 Grafana ownership question. `@microlabs/otel-cf-workers` remains the
maximal option, but it exports OTLP directly from the Worker, which §4 forbids.

Named `p1-telemetry` because it is telemetry plumbing, not a Grafana client. It should stay
destination-agnostic.

### 5.2 New worker: `workers/p1-tail`

Tail consumer. Receives `TraceItem[]`, converts to Loki streams, batches, and pushes to
`/loki/api/v1/push` with basic auth. Config:

```jsonc
// in ccr, p1-agent, p1-media, ccr-mcp-server wrangler.jsonc
"tail_consumers": [{ "service": "p1-tail-worker" }]
```

Loki labels stay tiny — `{service, env, level, outcome}` — everything else goes in the log line
(Loki indexes labels, not lines; high-cardinality labels are the classic way to make Loki expensive
and slow). Secrets: `LOKI_ENDPOINT`, `LOKI_USER`, `LOKI_TOKEN`.

**Note the naming rule** (`CLAUDE.md`): worker names are frozen once deployed because DNS, GCLB
routing, and service bindings reference them. Pick `p1-tail-worker` (or whatever) deliberately now.

### 5.3 Changes to published packages

| Package | Change | Dependency impact |
|---|---|---|
| `css-client` | Headers in `BaseEndpoint.request()`; response id capture; id in `P1ApiError`; optional `onRequest`/`onResponse`/`onError` hooks on `P1ClientConfig` | **None.** `crypto.randomUUID()` and `crypto.getRandomValues()` are ambient in Node 18+/browsers/Workers. |
| `p1-next-sdk` | Pass its own name/version into the client it constructs (`css-query-fetchers.ts`, `handler.ts`); continue an ambient trace if the host app has one | `@opentelemetry/api` as an **optional peer** (`peerDependenciesMeta.optional: true`), dynamically imported, never required |
| `p1-ai-chat` | Correlation id on the agent WebSocket handshake (`agentSocket.ts`) | None |
| `p1-media` | Headers on its upload/fetch paths (`server.ts`, `components/upload-flow.ts`) | None |

Version bump strategy: these are additive and backward compatible, so minor bumps. See
`docs/releasing.md` for which packages can be released independently.

### 5.4 Nothing to install on the Grafana side

Grafana Cloud already exists (`pantheon.grafana.net`, datasource `grafanacloud-pantheon-metrics`). We
need: the Loki push endpoint + credentials, the OTLP gateway endpoint + instance id/token, and a
derived-field config on the Loki datasource pointing `trace_id` at Tempo. Grafana Alloy is **not**
needed under this design.

---

## 6. Instrumentation seams

Each of these is a single function that every relevant call already flows through. That's why this
plan is small.

| Seam | File | What to add |
|---|---|---|
| Every outbound SDK call | `packages/css-client/src/endpoints/base.ts:68` | Correlation headers, timing, `onRequest`/`onError` hooks |
| Every inbound worker request | `workers/ccr/src/index.ts:67` | Context ingest, structured access log, existing metrics kept |
| Every DB query | `workers/ccr/src/db.ts:204` | Query span, duration, rowCount, timeout flag |
| Every worker→ccr call | `workers/p1-agent/src/css-api.ts:237` | Header forwarding, child span |
| Every model call | `workers/p1-agent/src/model.ts` (`ModelTransport`) | GenAI span + token/latency metrics — see §7 |
| Every MCP tool call | `workers/ccr-mcp-server/src/mcp-handler.ts:140` | Tool span, outcome, rate-limit denials |
| WebSocket lifecycle | `workers/ccr/src/durable-objects/websocket-connection-manager.ts` | Already has counters; add connection-scoped span/session id |

WebSockets don't fit request/response tracing. Treat a connection as one long-lived span with events,
and correlate via the session id we already have rather than trying to trace per-message — per-message
spans on a collaborative editor would be a volume disaster.

---

## 7. Profiling the MCP / AI surface

This is the part with the least prior art and the most room to get wrong. Three distinct subsystems:
the MCP server (`workers/ccr-mcp-server`), the chat agent (`workers/p1-agent`), and the model calls
themselves through AI Gateway.

### 7.1 Use the GenAI semantic conventions

OpenTelemetry has settled conventions for LLM spans. Use them rather than inventing attribute names —
it's what makes off-the-shelf Grafana dashboards and any future LLM-observability tool work without a
translation layer.

One span per model call, named `chat {model}`, with:

| Attribute | Source |
|---|---|
| `gen_ai.system` | `anthropic` / `openai` / `workers-ai` — already derivable from the provider prefix (`model.ts:createTransport`) |
| `gen_ai.request.model` | `AGENT_MODEL` |
| `gen_ai.response.model` | Response body (can differ from requested — matters for fallbacks) |
| `gen_ai.usage.input_tokens` / `output_tokens` | `CompletionUsage` (`model.ts:36`) |
| `gen_ai.response.finish_reasons` | Normalized stop reason |
| `gen_ai.operation.name` | `chat` |

Plus our own namespaced extras, because the standard doesn't cover them:

| Attribute | Why it matters |
|---|---|
| `p1.ai.cache_read_input_tokens`, `p1.ai.cache_creation_input_tokens` | Already normalized in `anthropic.ts:164-170`. Prompt-cache hit rate is the single biggest cost lever on a long agent loop; if it's near zero, something is silently invalidating the prefix. |
| `p1.ai.loop_iteration` | Which turn of the agentic loop this call is |
| `p1.ai.tool_calls` | Count of tool calls returned |
| `p1.ai.streamed` | Streaming vs not (`anthropic.ts:211` vs `:208`) |
| `p1.ai.aborted` | `isAbortError()` (`model.ts:77`) — user-cancelled turns are not errors and must not page anyone |
| `p1.ai.gateway_id` | `cf-aig-gateway-id` value |

### 7.2 The metrics that actually tell you something

Derived from spans (or emitted directly):

| Metric | Definition | Why |
|---|---|---|
| **TTFT** | Request start → first content delta on the stream (`anthropic.ts:218` event loop) | The only latency number a chat user perceives. p50/p95 per model. |
| **Total turn duration** | User message → final assistant message, across all loop iterations | What the user actually waits for. Distinct from per-call latency. |
| **Output tokens/sec** | `output_tokens / (end − first_token)` | Detects provider degradation independently of queueing |
| **Loop iterations per turn** | Histogram | A runaway agent shows up here first, before it shows up in the bill |
| **Cache hit ratio** | `cache_read / (cache_read + input_tokens)` | Cost. Also a canary for prompt-prefix churn. |
| **Cost estimate** | `tokens × per-model rate`, computed in the pipeline, not in the worker | Per-site cost attribution. Keep the rate table in one place; it changes. |
| **Error rate by status** | `apiErrorStatus()` (`model.ts:117`) split 429 / 5xx / other | 429s mean rate-limit tuning; 5xx means provider incident; 4xx-other means we built the request wrong |
| **Refusal / stop-reason distribution** | Normalized finish reasons | A spike in `max_tokens` stops means truncated answers customers are seeing |
| **Abort rate** | Aborted / total turns | High abort rate ≈ answers too slow or wrong; a product signal disguised as a technical one |

Label discipline: model and provider are fine as metric labels; **session id, site id, and user id are
not** — those go on spans and log lines.

### 7.3 AI Gateway is already in the path — use it

Model calls already route through Cloudflare AI Gateway (`model.ts:86-87`). The gateway keeps its own
request log and analytics, which is a second, independent view of exactly the calls we care about —
and it sees things we can't easily measure ourselves (upstream latency vs our own overhead, cache
hits at the gateway layer, per-provider error rates).

The join is the thing to build: AI Gateway accepts a metadata header on the request that it stores
alongside the log entry. Put `trace_id`, `session_id`, and `site_id` in it, and a gateway log row
becomes clickable through to our trace.

> **Verify before implementing:** the exact header name and value encoding (`cf-aig-metadata` and
> friends, plus cache-control headers like `cf-aig-cache-ttl`) should be checked against the current
> AI Gateway docs rather than taken from this document — this surface has moved.

### 7.4 MCP server

`registerTool` runs through one loop (`mcp-handler.ts:140`), so one wrapper instruments every tool:

- Span per tool invocation: `mcp.tool.name`, duration, outcome (`ok` / `error` / `rate_limited` —
  `rateLimitPreCheck` at `mcp-handler.ts:145` already distinguishes the third), argument **size** (not
  content), result size.
- Counters: invocations by tool, error rate by tool, rate-limit denials by tool. This is the data that
  tells you which tools are actually used, which are dead weight, and which are being hammered.
- **Propagate through to ccr.** The MCP handlers call ccr via the injected `fetcher`
  (`mcp-handler.ts` config → `css-api.ts`). Forward `traceparent` there and one trace spans
  `MCP tool call → ccr API → Postgres query`. That single trace is the thing you'll want the first
  time an agent edit is mysteriously slow.
- Also record `actingUser` presence (`mcp-handler.ts:120` — human-requested vs autonomous). Knowing
  what fraction of agent edits are human-initiated is a genuinely interesting product metric that
  costs one boolean.

### 7.5 Agent session reconstruction

The most useful artifact for debugging an AI system is not a metric, it's the ability to replay a
session: what the user asked, which tools ran in what order with what outcomes, how many loop
iterations, where it stopped.

Emit one structured `turn_summary` line at the end of every agent turn: `session_id`, `trace_id`,
`site_id`, iteration count, tool-call sequence (names + outcomes + durations, no arguments), total
tokens by kind, TTFT, total duration, stop reason. One line, queryable in Loki, no content.

### 7.6 Content is off by default

Prompts, completions, document bodies, and Yjs updates are **customer content**. Do not log them.

If prompt debugging becomes necessary, it needs to be a deliberate, separate feature: explicit
opt-in per environment, low sample rate, redaction, a shorter retention class, and a decision from
whoever owns customer-data policy. Not a flag someone flips in a hotfix. Note that OTel's GenAI
conventions treat message content as opt-in for exactly this reason — the default is off, and we
should keep it there.

---

## 8. Cardinality, PII, and cost rules

Write these down once and enforce them in review:

1. **Metric labels are low-cardinality only.** `env`, `service`, `version`, `route_pattern`, `method`,
   `status_class`, `model`, `provider`, `tool_name`, `outcome`. Never ids of any kind.
   `normalizePathPattern()` (`metrics-service.ts:265`) is the existing model for this — keep using it.
2. **Loki labels are even tighter.** `{service, env, level, outcome}`. Everything else lives in the
   JSON line and is queried with LogQL filters. High-cardinality Loki labels are the standard way to
   make logs slow and expensive.
3. **Ids live on spans and log lines**, where cardinality is free.
4. **Never log:** document content, Yjs updates, Puck data, tokens/JWTs/API keys, emails, prompts,
   completions, SQL parameters, request bodies. Redact by **allow-list**, never a deny-list — with a
   deny-list, a field added to a context object a year from now starts logging customer data silently;
   with an allow-list the failure mode is a missing dashboard field, not a leak.
5. **Redaction is always on and is not env-configurable.** There is deliberately no `LOG_REDACT=off`.
   Two reasons: a local process can run against a staging or production backend
   (`pnpm dev:starter:staging` + `.env.staging.local`), so "local" logs can hold real customer
   content; and `.logs/` being gitignored only prevents *commits* — an agent reading the file can
   carry content into a memory file, a session transcript, a PR comment, or a published artifact,
   none of which gitignore covers. Redaction is the only control upstream of all of those. To inspect
   a real payload while debugging, use a debugger breakpoint or a temporary call site marked with the
   `[claude]` prefix convention and deleted before commit; back the unsafe call with a
   `no-restricted-syntax` lint rule so it cannot merge.
6. **Data class comes from the backend host, not `NODE_ENV`.** At logger init, compare the resolved
   backend host (`CCR_BACKEND_URL` / `baseUrl`) against localhost and stamp every line with
   `data_class: 'local' | 'remote'`. A local process pointed at prod is handling customer content and
   `env === 'local'` would say the opposite. The field doubles as a filter: you can tell at a glance
   whether a given log file ever touched real content.
7. **Sample traces, not logs.** Head-based sampling on traces (start at 100% in staging, low single
   digits in production with always-sample-on-error). Access logs stay at 100% — they're the support
   tool.
8. **Telemetry must never break a request.** The existing `flushMetrics()` pattern — try/catch, warn,
   continue (`metrics-service.ts:246-254`) — is correct. Keep it for every exporter. Every flush goes
   through `ctx.waitUntil()`, never blocks the response.

---

## 9. Phases

### Phase 1 — Context and structured logs (no Grafana dependency)

- `packages/p1-telemetry` with trace-context, request context, logger, redaction.
- SDK: four headers out, id echoed back, id in `P1ApiError`. `css-client` + `p1-next-sdk`.
- Workers: ingest/mint context at the edge; forward `traceparent` on every internal hop; replace
  `console.*` in the request path with structured `log.*`.
- **Fix the dead metrics push**: either point `METRICS_PUSH_ENDPOINT` at something real or set
  `METRICS_ENABLED: "false"` in staging/prod until Phase 3, so the config stops claiming to work.
- Deliverable: `wrangler tail` becomes genuinely useful; support can trace a customer request id.

#### Sinks: the extension point, built now with one implementation

The logger fans out to an array of `Sink` objects and knows nothing about any destination.
**There is no Grafana sink** — deployed workers write structured JSON to `console`, and the Phase 2
tail consumer (a separate worker) is what pushes to Loki. So the in-process sink list is `[console]`
today and stays that way; anything else is additive.

```ts
interface Sink {
  write(line: LogLine): void;      // never throws, never awaits
  flush(): Promise<void>;          // idempotent; no-op for console
}
```

Registration is construction-time (`initLogger({ sinks })`) rather than a `subscribe()` bus, so the
sink list is complete before the first `emit()` — dynamic subscription would silently drop any line
emitted before a sink attached, and module-import order in a Worker isolate is not a good thing to
depend on. `addSink()` exists as a single documented escape hatch for a **dev-only** sink registered
from a module that production never imports, which keeps dev-only sink code out of deployed bundles.

Two things are built now even though nothing needs them yet, because they are expensive to retrofit
and free to add:

1. **`flush()` wired at every entry point** via `ctx.waitUntil()` — `fetch`, `queue`, `scheduled`, DO
   `fetch`, DO `alarm`. It's a no-op while console is the only (synchronous) sink. Adding an async
   sink later then touches one file instead of every entry point in four workers.
2. **The full line shape**, including `seq` (per-process monotonic counter, breaks same-millisecond
   ties), `run_id` (per process launch), and `data_class` (§8.6). Backfilling fields into a format
   that queries and dashboards already depend on is the annoying kind of change.

#### Local ndjson collector — built (workers and Node; browser still deferred)

Motivation: a single editor interaction spans four runtimes (browser, Next server, ccr worker,
p1-agent), so a shared file with one `trace_id` filter reconstructs the whole causal chain — which is
what makes agent-driven debugging work. Worker code has no filesystem access, so it has to be an HTTP
collector rather than a direct file write, and that's also what unifies the runtimes into one
interleaved file.

**The browser sink is still deferred**, and deferring it costs no rework: the collector doesn't care
who POSTs. It's a second code path rather than a config change — no `AsyncLocalStorage`, so it needs
its own timer-based buffer, plus `sendBeacon` on `pagehide` and its own redaction entry point.

As built:

- `scripts/log-sink.mjs` — Node, binds **127.0.0.1 only**, one `createWriteStream`, appends
  `lines.join('\n')` per batch (Node serializes stream writes, so no partial-line interleaving).
  Wraps any non-JSON input in a valid JSON envelope so **every line in the file parses** — that's the
  load-bearing property for `jq` and for agent consumption. Stamps `recv_ts` for single-clock
  ordering and clock-skew detection. No read endpoint; reading is `jq` on the file.
- HTTP sink batches into the **ALS request context** (never a module-level buffer — see the
  `metrics-service.ts:59-66` bug in §1) and flushes via `waitUntil`, so roughly one POST per request.
  Body is ndjson with `content-type: text/plain`, which keeps the browser request a CORS simple
  request and avoids a preflight per batch.
- Collector-down is a non-event: catch, drop counter, circuit breaker, **one** warning rather than one
  per batch, probe every ~10s, report the hole on reconnect. No batch retries.
- File lifecycle owned by the collector (not per-process, so hot reloads don't truncate):
  `current.ndjson` truncated on collector start, previous kept, rotate at ~64MB keeping two.
  `.logs/` needs adding to `.gitignore` — the existing `*.local` / `.env.*` patterns don't cover it.
- Port **8799**. Taken already: 8787 (ccr), 8788 (media, mcp-server), 8790 (p1-agent `dev:stack`),
  9229–9231 (inspectors).
- Config via `P1_LOG_SINK` in each worker's **top-level** `wrangler.jsonc` `vars`. `vars` is
  non-inheritable, and the `staging` / `production` env blocks define their own (`wrangler.jsonc:152`,
  `:233`), so the sink is *structurally* impossible to enable in a deployed worker rather than merely
  unset. Verify the value actually reaches `env.P1_LOG_SINK` under `wrangler dev` before relying on
  it — no worker currently uses `.dev.vars`, and `dev:stack` passes env at the turbo level via
  `dotenv`, which does not reach into the workerd sandbox on its own.
- Redaction still applies (§8.5), and the browser is the runtime most likely to be holding document
  content, so client-side redaction runs before the POST.

### Phase 2 — Cloudflare Workers Logs (no Grafana dependency)

Deliberately *not* a forwarder. Structured JSON to `console` gets indexed by Workers Logs, so
correlation and triage work in the Cloudflare dashboard for 7 days at zero infrastructure cost.

- Normalize the `observability` blocks across all four workers (`p1-agent` has a bare
  `observability.enabled`; `ccr-mcp-server` has `invocation_logs: false`).
- Sampling and level thresholds tuned against the 5B/day ceiling if the DOs prove chatty.
- Deliverable: paste a request id into the Cloudflare dashboard, get the whole server-side story.

### Phase 3 — Forwarder to PIE's collectors *(blocked; not scheduled)*

Waits on a real trigger — retention beyond 7 days, an alert we can't write, or a join with
non-Cloudflare telemetry — and on the PIE conversation in §3.1. Shape is sketched in §3.3.

### Phase 3b — Metrics and DB visibility

Independent of the forwarder, and the more likely first thing anyone actually asks for, since
alerting runs on metrics rather than logs.

- Replace `metrics-service`'s transport; keep its API so the ~dozen call sites don't churn.
- DB: query spans at `runSqlUnsafe`, `application_name` on the connection, low-cardinality
  sqlcommenter (**not** per-request — see §4.4, it would zero Hyperdrive's cache hit rate).
- Deliverable: p95 breakdowns and real DB visibility.

### Phase 4 — AI and MCP profiling

- GenAI spans + token/latency/cost metrics at the `ModelTransport` seam.
- AI Gateway metadata join.
- MCP tool spans and counters; `turn_summary` lines.
- Deliverable: an AI dashboard — TTFT, tokens/sec, cache hit rate, cost per site, tool usage.

### Phase 5 — SDK opt-in hook (optional, last)

- Documented `onRequest`/`onResponse`/`onError` hooks and an optional `@opentelemetry/api` bridge, so
  customers can put SDK calls in *their* dashboards.
- Off by default, forever.

---

## 10. Decisions needed

1. **Grafana credentials and endpoints.** Who owns the Grafana Cloud stack, and can we get a Loki
   push credential and an OTLP gateway token scoped to this project? Blocks Phase 2.
2. **Log retention and volume budget.** Loki is priced on ingest. A 100%-sampled access log across
   four workers is a real number — worth estimating before turning it on in production.
3. **Tail-consumer worker name.** Frozen once deployed (`CLAUDE.md`). Decide it deliberately.
4. **`METRICS_ENABLED` in the meantime.** Leave it lying (`true`, exporting nothing) or set it false
   until Phase 3? Recommend false — a config that claims to work is worse than one that doesn't.
5. **Trace sampling rate in production**, and whether error traces are always sampled (recommend yes).
6. **Content capture policy — mostly settled.** Redaction is always on and not env-configurable
   (§8.5), so prompts, completions, and document bodies are never logged in any environment. Open
   part: does this need a sign-off from whoever owns customer-data policy to be a *stated* rule rather
   than an engineering convention, and is there any circumstance under which sampled content capture
   would be permitted with explicit customer consent? Default answer is no.
7. **`docs/ccr/MONITORING-PLAN.md`** — mark superseded and leave, or delete? It has a real code
   artifact still in the tree, so a "superseded by" header pointing here is probably kinder to the
   next reader.
