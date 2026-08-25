# MCP Server Rate Limiting & Circuit Breaker — Runbook

**Subject:** `workers/mcp-server/`
**Implements:** [PCC-3192](https://getpantheon.atlassian.net/browse/PCC-3192) — closes red-team Finding 4 in [`mcp-server-red-team-2026-05-12.md`](mcp-server-red-team-2026-05-12.md)
**Audience:** anyone tuning rate limits, debugging a 429 in the wild, or extending the gating to new endpoints/tools.

---

## What this protects against

A single misbehaving agent or compromised OAuth token previously had unbounded ability to:

- Flood the CCR backend with tool calls (no per-tool, per-user, or per-IP cap).
- Burn through OAuth `/token` and `/register` from a single IP (no cap there either).
- Cascade a backend incident back to every active client — there was no circuit breaker around `apiClient.doFetch`, so each MCP tool call would wait the full timeout, hold resources, and amplify the upstream load while it was trying to recover. Hyperdrive connection sensitivity is documented in [`docs/handoff-sbx1-500-errors.md`](../handoff-sbx1-500-errors.md).

After PCC-3192 there is a per-tool rate limit, an OAuth-endpoint rate limit, and a per-isolate circuit breaker around the backend.

---

## Validation note (read this before relying on enforcement)

Sustained-load and minimum-limit validation against the `.workers.dev` sbx1 deployment found the binding **does not enforce** on this account / configuration:

- **Sustained-load test:** 100 sequential `/token` requests over 25s against the 20/60s `RL_OAUTH` binding all received non-429 responses.
- **Minimum-limit spot check:** with `RL_OAUTH simple.limit: 1, period: 60` (the tightest possible), 5 sequential `/token` requests over 5 seconds **all** returned `success: true` from `.limit()`. Zero 429s.

The minimum-limit spot check rules out Cloudflare's documented "permissive, eventually consistent" caveat as the cause — even at the absolute-tightest limit, the binding allowed every request. The implementation was verified correct via temporary diagnostic logging: `.limit()` is invoked with the documented key shape and returns the documented `{ success: boolean }` shape; the underlying limiter simply does not deny on this deployment.

The cause is **not currently isolated**. Cloudflare docs do not document a Free-vs-Paid distinction for the binding, do not document a `.workers.dev`-vs-zone-routed distinction, and do not document any other condition that would explain a no-op binding ([Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)). Possibilities include an account-level configuration issue, a subdomain-routing-specific behaviour (`.workers.dev` vs custom-zone), or an undocumented requirement — none confirmed.

**Implications:**

- **Production validation must be performed on the actual production Cloudflare account during rollout, repeating the limit:1 spot check.** If the spot check fires (i.e. the second request returns 429), the rate limiter is functional and the production limits in [`workers/mcp-server/wrangler.jsonc`](../../workers/mcp-server/wrangler.jsonc) apply. If it does not fire, the binding is non-functional on production too — the rate-limit gate is effectively absent and follow-up work must be tracked.
- Until production validation completes, treat the rate limiter as **defense-in-depth that is verified at the unit-test layer** (mocked `.limit()` returns in [`workers/mcp-server/tests/rate-limit.spec.ts`](../../workers/mcp-server/tests/rate-limit.spec.ts)) but **unverified at the runtime-enforcement layer**.
- The unit tests prove the wrapper code is correct (responds to `success: false` properly, routes mutation/read/anon correctly, fails OPEN with warn-once on missing binding) — they cannot prove the binding actually enforces on a given deployment.
- The circuit breaker is independent of this and is verified end-to-end at the unit-test layer (per-isolate state machine, no Cloudflare-side dependency).

---

## Where the limits live

All four rate-limit bindings are declared three times in [`workers/mcp-server/wrangler.jsonc`](../../workers/mcp-server/wrangler.jsonc) — once at the top level (for `wrangler dev`) and once per deployable env. Wrangler does **not** inherit `ratelimits` into env stanzas, so each env must redeclare them explicitly.

| Stanza            | File range              | Purpose                          |
|-------------------|-------------------------|----------------------------------|
| Top level         | `wrangler.jsonc:22-29`  | `wrangler dev` (local)           |
| `env.sbx1`        | `wrangler.jsonc:67-72`  | `pnpm deploy:sbx1`               |
| `env.production`  | `wrangler.jsonc:107-112`| `pnpm deploy`                    |

Line ranges are approximate — search for `"ratelimits"`.

The application code that consults the bindings lives in [`workers/mcp-server/src/rate-limit.ts`](../../workers/mcp-server/src/rate-limit.ts) (binding wrappers) and [`workers/mcp-server/src/mcp-handler.ts`](../../workers/mcp-server/src/mcp-handler.ts) (per-tool gates).

---

## Current values + provenance

Each binding is `period: 60` (Cloudflare GA spec only allows `10` or `60`; we standardised on per-minute to match the human-readable rationale).

| Binding              | Limit (req / 60s) | Scope key shape                              | Why this number                                                                                                                                                                                                                |
|----------------------|-------------------|----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `RL_TOOLS_READ`      | 120               | `rl:tool:<name>:user:<id>` AND `rl:tool:<name>:ip:<ip>` | ~2/sec sustained — generous enough for an interactive agent doing list → navigate → get loops, restrictive enough to discourage enumeration scraping. Engineering judgment.                                                    |
| `RL_TOOLS_MUTATION`  | 30                | same shape                                   | Half-second floor between writes per (user, tool). **Grounded in Hyperdrive pool sizing.** Per [`docs/handoff-sbx1-500-errors.md`](../handoff-sbx1-500-errors.md), sbx1 max_connections=100 with HD pool 30+10. A single agent at 30/min/tool across 5 mutation tools = 150 req/min worst case, well under the HD pool ceiling even with concurrency. |
| `RL_OAUTH`           | 20                | `rl:oauth:<endpoint>:ip:<ip>`                | Tight enough to throttle credential-stuffing or registration flooding. Real users hit `/authorize`, `/token`, `/register`, `/callback` ~1× per hour. Engineering judgment.                                                     |
| `RL_TOOLS_ANON`      | 60                | `rl:tool:<name>:anon:<ip>`                   | Fallback used when `actingUserId` is unavailable (rare — `ctx.props` missing). Halfway between read (120) and mutation (30) since we can't distinguish. Engineering judgment.                                                  |

Per-tool checks call `.limit()` **twice** — once with the user-scope key and once with the ip-scope key. Both must pass; either failing returns denied. The user-scope catches a compromised token regardless of source IP; the ip-scope catches a misconfigured client looping or a wide pool of stolen tokens from one host.

---

## How to change a value

1. Edit `simple.limit` (and only `simple.limit`) for the binding in **all three stanzas** in [`workers/mcp-server/wrangler.jsonc`](../../workers/mcp-server/wrangler.jsonc).
2. From `workers/mcp-server/`:
   - sbx1: `pnpm deploy:sbx1`
   - production: `pnpm deploy`
3. Effective on the next request after the deploy completes. No restart, no migration. Cloudflare Rate Limiting bindings are stateless from the worker's perspective — counters live in Cloudflare's edge.

If you only need to tune one env (e.g. raise sbx1 for load testing), edit just that env's stanza. The `'env stanzas use disjoint namespace_id sets'` test in [`workers/mcp-server/tests/config/wrangler-validation.spec.ts`](../../workers/mcp-server/tests/config/wrangler-validation.spec.ts) ensures the envs don't share counters even when limits diverge.

### Don't change

- `period`: must be `10` or `60` (Cloudflare GA constraint). Tests pin to `60`.
- `namespace_id`: must remain disjoint across the three stanzas (see Constraints below).
- `name`: hard-coded in `Env` type in [`workers/mcp-server/src/types.ts`](../../workers/mcp-server/src/types.ts).

---

## Constraints

### `period` must be 10 or 60

Cloudflare's Rate Limiting binding only supports those two values. Test `'uses period=60 and a positive integer limit ...'` enforces `60` specifically — if you ever switch to `10`, update the test and the runbook in lockstep.

### `namespace_id` must be disjoint across envs

Cloudflare's Rate Limiting namespaces are **account-scoped**. Two bindings sharing a `namespace_id` share the same counters even across different workers and envs. So if `sbx1` and `production` ever shared an OAuth namespace_id, a CI load-test against sbx1 from a runner IP would burn the prod OAuth bucket for that same IP.

Current series:

- **Top level** (`wrangler dev`): `31923xx` (READ=`3192310`, MUTATION=`3192320`, OAUTH=`3192330`, ANON=`3192340`)
- **sbx1**: `31921xx` (`3192110`/`3192120`/`3192130`/`3192140`)
- **production**: `31922xx` (`3192210`/`3192220`/`3192230`/`3192240`)

The test `'env stanzas use disjoint namespace_id sets across dev / sbx1 / production'` collects every namespace_id from every stanza and asserts the three sets are pairwise disjoint. Violating it fails CI — that's the regression guard against `git mv` / copy-paste errors.

If you add a fourth env (e.g. a `staging` between sbx1 and prod), pick a new series (e.g. `31924xx`) and re-run the disjoint test.

---

## Tool categorisation: mutation vs read

Defined as a `MUTATION_TOOLS` Set in [`workers/mcp-server/src/mcp-handler.ts`](../../workers/mcp-server/src/mcp-handler.ts) — single source of truth for "is this a mutation?":

```ts
const MUTATION_TOOLS = new Set<string>([
  'apply_document_edits',
  'create_page',
  'start_edit_session',
  'complete_edit_session',
  'abort_edit_session',
]);
```

Every other registered tool (8 today: `list_sites`, `list_branches`, `list_documents`, `get_document`, `check_edit_permission`, `get_branch_presence`, `get_document_presence`, `list_components`) routes to `RL_TOOLS_READ`.

To re-categorise: edit the Set. No other code changes needed — the `rateLimitPreCheck()` wrapper consults the Set on every call.

---

## OAuth endpoint coverage

| Endpoint     | Owner                                | Where the gate lives                                 |
|--------------|--------------------------------------|------------------------------------------------------|
| `/authorize` | Our `defaultHandler`                 | [`src/index.ts`](../../workers/mcp-server/src/index.ts), inside `defaultHandler.fetch`     |
| `/callback`  | Our `defaultHandler`                 | same                                                 |
| `/token`     | `@cloudflare/workers-oauth-provider` | Wrapping `fetch` around `OAuthProvider` default export, in [`src/index.ts`](../../workers/mcp-server/src/index.ts) |
| `/register`  | `@cloudflare/workers-oauth-provider` | same                                                 |

All four guards skip the rate-limit check when `request.method === 'OPTIONS'` (CORS preflight). Without that bypass, a 429 returned for an OPTIONS preflight would lack `OAuthProvider`'s CORS response headers and break browser-based MCP clients. The bypass predicate is centralised in `shouldBypassRateLimit()` in `src/rate-limit.ts` so future endpoint guards inherit the same behaviour.

---

## Circuit breaker

Lives in [`workers/mcp-server/src/circuit-breaker.ts`](../../workers/mcp-server/src/circuit-breaker.ts). Wired in via [`workers/mcp-server/src/shared/api-client.ts`](../../workers/mcp-server/src/shared/api-client.ts) — `doFetch` calls `breaker.execute(...)` for every backend request.

| Setting               | Default value | Source                                                                 |
|-----------------------|---------------|------------------------------------------------------------------------|
| `failureThreshold`    | 5             | "Sustained backend down" signal — single transient flap won't trip it. |
| `failureWindowMs`     | 30,000        | Stale streaks (slow drip of 5xx over hours) reset to a fresh streak of one. Matches the ticket's "consecutive 5xx in 30s" wording without latching forever. |
| `cooldownMs`          | 30,000        | Matches typical Cloudflare/Hyperdrive recovery time.                   |
| `halfOpenSuccessesNeeded` | 1         | Single probe sufficient to confirm recovery.                           |

### What counts as a failure

| Response             | Closed state            | Half-open state               |
|----------------------|-------------------------|-------------------------------|
| 2xx / 3xx            | Resets streak           | Closes breaker (probe success) |
| 4xx                  | **No-op** (client error, not upstream incident) | **Closes breaker** (upstream is responsive — liveness probe success even if not for this request) |
| 5xx                  | Counts as failure       | Re-opens with fresh cooldown  |
| Network error (thrown) | Counts as failure     | Re-opens with fresh cooldown  |

The 4xx-closed-vs-half-open asymmetry is deliberate — see the comment block in `circuit-breaker.ts:recordResponse`.

### State storage

Per-isolate, module-scoped `Map<string, CircuitBreaker>` keyed by upstream service name. Cloudflare load-balances across isolates, so each isolate keeps its own breaker view. **There is no cross-isolate consensus.** A Durable Object would give consensus but at the cost of latency on every request — explicit trade-off documented in `circuit-breaker.ts`.

Per-isolate state means: when the upstream comes back, isolates with traffic discover it independently as their cooldowns expire and probes succeed. Isolates with no traffic stay open until they next see a request. Acceptable.

---

## Failure modes

| Scenario                                              | Behaviour                                                                                                                                                                                                                                                                                                                                                          |
|-------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Rate-limit binding is missing in `Env` (drift / dev)  | **Fail-OPEN** — request proceeds, and `console.warn` fires **once per binding name per isolate** (`rate-limit: binding undefined (...) — failing OPEN`). Mirrors the [`binding-mode.ts`](../../workers/mcp-server/src/binding-mode.ts) (PCC-3193) one-shot pattern. The per-binding granularity means a partial misconfig (e.g. `RL_OAUTH` missing but `RL_TOOLS_READ` present) surfaces both. |
| Per-user OR per-IP rate limit hit                     | Tool handler returns a `ToolResult` with `isError: true` and text `Rate limit exceeded for tool "<name>" (<per-user/per-IP> quota). Please wait a minute before retrying.` LLM sees this as a normal tool error and can decide whether to back off / surface to the user.                                                                                            |
| OAuth-endpoint rate limit hit                         | HTTP 429 with body `{"error":"rate_limited","scope":"oauth"}` and `Retry-After: 60` header. (Note: this body does NOT follow the OAuth 2.0 RFC 6749 §5.2 error format — see Deferred follow-ups below.)                                                                                                                                                            |
| Circuit breaker opens                                 | `doFetch` throws `CircuitOpenError` with `message: 'Backend "CCR_BACKEND" temporarily unavailable (circuit open) — retry in Ns'` and a `retryAfterMs` field. The existing tool-handler catch path (`formatError`) turns it into LLM-facing text. Programmatic backoff code can switch on `instanceof CircuitOpenError` since the typed instance is preserved (not re-wrapped). |
| Circuit half-open probe                               | Exactly one request is allowed through to test liveness. Any non-5xx response (incl. 4xx) closes the breaker; 5xx or network error re-opens with a fresh `cooldownMs`.                                                                                                                                                                                              |

---

## Operating notes

- **Limits move independently per binding.** Bumping `RL_TOOLS_READ` does not affect `RL_TOOLS_MUTATION` or `RL_OAUTH`. They share no counters.
- **Envs move independently.** Disjoint `namespace_id` series mean tuning sbx1 doesn't perturb production and vice-versa.
- **Tuning the mutation limit requires Hyperdrive math.** The 30/min number is grounded in sbx1 max_connections=100 with HD pool 30+10 (per [`docs/handoff-sbx1-500-errors.md`](../handoff-sbx1-500-errors.md)). Production max_connections=200 with HD pool 60+20 leaves more headroom — if you raise the mutation limit aggressively, recompute against the prod pool first.
- **Circuit breaker is per-isolate.** Don't expect one isolate's experience of upstream-down to be visible to another isolate. If you need cross-isolate consensus, that's a Durable Object change — out of scope here.
- **Local dev fails open.** `wrangler dev` doesn't apply the bindings reliably; the wrappers warn once and let requests through. Useful for local iteration but means the dev environment is not a faithful representation of rate-limit behaviour. Use `pnpm deploy:sbx1` to test rate-limit interactions.

---

## Where to look in Workers Logs

The MCP server has Workers Logs `observability.logs.enabled: true` in both deployable envs (set up in PCC-3193). Three signals to watch:

1. **Binding-mode cold-start log** (PCC-3193): `CCR_BACKEND binding: service-binding (fetcher present)` once per isolate. If it warns `public-fetch (fetcher MISSING ...)` instead, the agent key is transiting the public Internet.

2. **Rate-limit drift warns** (PCC-3192): `rate-limit: binding undefined (<binding-name>) — failing OPEN. ...` Once per binding per isolate. Seeing one of these in sbx1 or production means a binding was dropped from `wrangler.jsonc` and the gate is open.

3. **Circuit breaker activity**: not currently logged at the breaker layer — `CircuitOpenError` surfaces as a regular error in the tool-handler logs (look for the `Backend "CCR_BACKEND" temporarily unavailable` substring). If breaker visibility becomes important, add a structured log inside `recordFailure` / on state transitions — that's a small follow-up, not in the PCC-3192 scope.

To query via the observability MCP (`mcp__plugin_cloudflare_cloudflare-observability__query_worker_observability`), filter:

- `$metadata.service` includes `css-mcp-server-sbx1` or `css-mcp-server-prod`
- `$metadata.message` regex `rate-limit:|Backend "CCR_BACKEND"`
- `$metadata.level` ∈ {warn, error}

---

## Deferred follow-ups

These were called out during pre-merge review and explicitly deferred from the PCC-3192 scope:

- **OAuth 2.0 error format on 429.** The current 429 body (`{"error":"rate_limited","scope":"oauth"}`) does not follow [RFC 6749 §5.2](https://datatracker.ietf.org/doc/html/rfc6749#section-5.2) (`{"error":"<one of: invalid_request, ...>","error_description":"..."}`). Cosmetic spec compliance, no client interop impact today (every MCP client we observe handles 429 generically).
- **`/.well-known/*` endpoints not rate-limited.** Static OAuth metadata; low DoS value vs cost-of-implementation. Add if observed in attacker traffic.
- **`getClientIp()` `'unknown'` fallback.** When `CF-Connecting-IP` is missing (only in `wrangler dev`), all such requests share one bucket. Intentional fail-safe grouping; could refine but only meaningful in local dev.
- **`MUTATION_TOOLS` Set vs hanging `isMutation` on tool definition.** Refactor candidate — would touch [`src/shared/tools.ts`](../../workers/mcp-server/src/shared/tools.ts) and arguably belongs there. Leave as separate ticket.
- **Structured circuit-breaker logging.** As above, add if breaker visibility becomes important.

---

## Related references

- Cloudflare Rate Limiting binding (GA 2025-09-19): https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Pre-existing Hyperdrive sensitivity: [`docs/handoff-sbx1-500-errors.md`](../handoff-sbx1-500-errors.md)
- Red-team report (Finding 4): [`docs/security/mcp-server-red-team-2026-05-12.md`](mcp-server-red-team-2026-05-12.md)
- PCC-3193 binding-mode pattern (cold-start drift log): [`workers/mcp-server/src/binding-mode.ts`](../../workers/mcp-server/src/binding-mode.ts)
