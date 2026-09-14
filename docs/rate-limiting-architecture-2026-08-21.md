# Rate-limiting architecture for p1-platform — 2026-08-21

Design for inserting rate limiting across the platform. Companion to the DB-saturation
investigation (`docs/prod-db-saturation-investigation-2026-08-19.md`) and the
cache-remediation plan (`docs/cache-remediation-execution-plan.md`). Design only — no code
or ticket changes accompany this document.

## Recommendation in one paragraph

Put the authoritative limiter **inside `collaborative-state-worker`** (post-auth,
pre-dispatch), keyed per sat_-token and per site, weighted by a small route-class
taxonomy, using the **Workers Rate Limiting binding** for rate caps plus a **Durable
Object semaphore** for the two route classes where global accuracy matters
(expensive-listing, execute-job). Ship it in log-only mode first.

**Sequencing revised 2026-08-21 (zone-first variant, §8a):** platform lead has committed
to a days-to-weeks zone migration, which changes the outer layers. The **interim
workaround layer is skipped entirely** — no Cloud Armor rules (L2), no Access-token
workers.dev lockdown (L3); the zone replaces both structurally (zone WAF; custom domains
+ `workers_dev: false`). L1 shrinks to its irreducible core for the first ship: the two
DO semaphores + the 429 contract + shadow-mode logging; binding-based per-token caps
follow. The zone migration runs as a parallel near-term track, not a someday initiative
— see §8a for what it deletes, what it adds, and the Enterprise-tier gate that is now
the first action item. The in-worker limiter remains authoritative regardless: it is the
only layer that protects the actual scarce resource (Postgres) on every path, including
service-binding lanes the zone never sees.

---

## 1. What we are protecting, and from what

The scarce resource is the shared CloudSQL Postgres behind `collaborative-state-worker`
(~64-connection ceiling via Hyperdrive; when pinned, all platform operations degrade
~10x). Three measured overload patterns, none limited today:

| Pattern | Measured | Identity at the worker | Right response |
|---|---|---|---|
| Customer tooling flood (11.5k `versions/latest`/hr; pathPrefix trie crawl = 48% DB time) | authenticated, one `sat_` token, UA `node`, a single client IP behind GCLB | per-token | 429 + Retry-After contract an agent can obey |
| Crawler/render storm (34.6k req/3h; junk-path 404 long tail, 42.6% DB time) | arrives via the customer renderer's egress IPs — **end-client IP is invisible** | per-site only | per-site serve budget; real fix is R2 materialization + PCC-3711 allowlist |
| Self-inflicted fan-out (CF purge API error 1134) | our own workers | n/a | internal batching that respects downstream limits; same header contract internally |

Two structural facts drive the whole design:

- **Per-IP keys are nearly useless at the Cloudflare edge today.** All public traffic
  arrives via GCLB, so `CF-Connecting-IP` is a Google front-end egress IP shared by every
  client. The true client sits in the first XFF hop: the 2026-08-20 sweep showed
  `24.22.229.43, 34.102.174.16` (client, GCLB) on every sampled request; the 2026-08-19
  enumeration showed the same client IP plus a 34.96.x first hop on part of the traffic
  (possibly GCP-hosted tooling — unresolved, and irrelevant to the keying argument).
  Worse, render-path traffic is aggregated a second time by the customer's Next.js
  renderer, so even the first XFF hop is the renderer's egress, not the end user. The only
  edge that sees real client IPs today is **GCLB itself** (Cloud Armor's home turf).
  Consequence: authenticated abuse must be limited **per token/site**, not per IP; this
  also means the existing css-mcp-server per-IP buckets keyed on `CF-Connecting-IP`
  (`workers/css-mcp-server/src/index.ts:51`) silently lump all GCLB-fronted users into
  one bucket — a latent false-positive noted in §10.
- **Any limiter outside the worker is bypassable** while
  `collaborative-state-worker-production.pantheon-p1-production.workers.dev` is publicly
  reachable. An in-worker limiter is bypass-proof by construction; edge layers are
  defense-in-depth plus invocation-cost savings.

### Existing in-repo precedent

`css-mcp-server` already uses the Workers Rate Limiting binding (PCC-3192, red-team
Finding 4): four bindings per env with disjoint account-scoped `namespace_id`s
(`workers/css-mcp-server/wrangler.jsonc`), dual (user, IP) keying, fail-open with
warn-once on missing binding (`workers/css-mcp-server/src/rate-limit.ts`), and OPTIONS
bypass. The binding went GA 2025-09-19; `period` must be 10 or 60. This design extends
that pattern rather than inventing a new one.

### Traffic classes at collaborative-state (verified in `src/`)

| Caller | Path in | Credential | Limit treatment |
|---|---|---|---|
| Customer tooling | GCLB or workers.dev | `sat_` token (`X-API-Key`) | primary target: per-token + per-site |
| Renderer (p1-starter / p1-next-sdk) | GCLB (`ccr.p1.pantheon.io` default) | `sat_` token, `read:published` | own token ⇒ own budget; serve-content class, generous |
| Dashboard (content.pantheon.io) | GCLB | Auth0/broker JWT | per-user, generous burst |
| css-mcp-server | **service binding** `CSS_BACKEND` | `aak_` key + `X-Acting-User-*` | already self-limited (PCC-3192); light backstop per aak_ key |
| p1-media | **service binding** `CSS_SERVICE` | internal | bypass (see internal-bypass note, §4) |
| p1-agent | **public fetch** to workers.dev (`CSS_BACKEND_URL`) | key | treat as external until migrated to a service binding (adjacent rec) |
| DO sync/queues, `/internal/*` | in-process / `X-Internal-Secret` | internal secret | full bypass |
| Realtime editing | `/realtime` WebSocket, `?apiKey=` | JWT/sat_ | connect-rate cap only, never mid-session (§6 failure table) |

---

## 2. Recommended layered composition

| Layer | Mechanism | Owns which abuse | Accuracy | Availability | Rollout order |
|---|---|---|---|---|---|
| **L1 app-level (authoritative)** | in-worker middleware: Rate Limiting binding (per-class namespaces) + DO semaphore for expensive classes | authenticated per-token/per-site floods; per-site serve-content budget; route-cost weighting | binding: per-colo approximate (good enough — see note); DO: exact | now | **1** (log-only), 3 (enforce) |
| ~~**L2 GCLB / Cloud Armor**~~ | ~~rate-based ban/throttle rules on the backend service, per client IP~~ | **SKIPPED under zone-first (§8a)** — zone WAF replaces it; do not build throwaway rules | — | — | — |
| ~~**L3 workers.dev lockdown (Access tokens)**~~ | ~~Cloudflare Access service tokens (or shared-secret header from GCLB)~~ | **SKIPPED under zone-first (§8a)** — replaced structurally: zone routes/custom domains + `workers_dev: false` + internal callers on service bindings (makes the p1-agent public-fetch fix mandatory) | exact (deny-by-default) | with zone | with zone |
| **L4 MCP-server-side** | existing PCC-3192 buckets; add backoff guidance text + acting-user key fix | agent tool-call loops before they reach the backend | per-colo | shipped | tune anytime |
| **L5 CF zone WAF** | zone rate-limiting rules, bot management, IP lists | per-IP at true edge (real client IPs post-zone); crawler storms; unauthenticated floods; per-token at edge **if** Enterprise ARL (§8a gate) | zone-wide | zone migration now a near-term parallel track (§8a) | with zone |

Per-colo approximation note: the binding's counters are colo-local, but because GCLB
funnels all public traffic through a small set of Google egress ranges near the LB
region, requests concentrate in very few Cloudflare colos — for the dominant traffic
shape, per-colo counting approximates global counting unusually well. The measured abuse
(a single-client sweep averaging ~3.2 rps, peaking ~11.6 rps per 5-min bucket) would have been fully visible to a single colo's
counter. Where that assumption is not safe (concurrency caps on 20-second listing
queries, single-flight execute jobs), use the DO semaphore instead.

Explicitly rejected as the primary mechanism: KV/Postgres request accounting per request
(adds latency + write amplification to the resource we are protecting), and GCLB-only or
zone-only enforcement (bypassable via workers.dev; blind to token identity).

---

## 3. L1: the in-worker limiter

### Insertion points

1. **Main gate** — `workers/collaborative-state/src/index.ts`, in `handleRequest` after
   `authenticate()` + allowlist (line ~433) and before the cached-content forward /
   `dispatchRoute`. Everything needed for keying is in scope: `route.handler`,
   `route.params.siteId`, `principal` (type `service`/`user`/`agent`, `siteId`, token
   identity). Deny returns through the existing `cors()` helper so 429s carry CORS
   headers.
2. **Serve-content miss budget** — inside `CachedContent.fetch`
   (`src/entrypoints/cached-content.ts`). The entrypoint only executes on an edge-cache
   miss, so a limiter there naturally charges **misses only** — cache hits stay free,
   which is exactly the cost model (a hit touches no Postgres). 429s from here must set
   `Cache-Control: no-store` so a deny is never cached as the content. The pre-dispatch
   gate skips the serve-content class for exactly this reason (it would otherwise count
   hits).
3. **Realtime connect** — in the `realtime` dispatch branch, before the DO WebSocket
   upgrade: a connect-rate cap only.

`authenticate()` itself still costs a (memoized, 60s) DB lookup for unseen tokens, and
`parseRoute` 404s cost nothing — pre-auth junk floods are L2/L3's job, not L1's.

### Keys and mechanism per check

Every request pays at most two binding `limit()` calls (fast, no added round trip);
expensive classes additionally take a DO semaphore acquire.

- **Per-actor:** `rl:<class>:tok:<tokenId>` for `sat_` (from `ValidateTokenResult.tokenId`
  — never the raw token), `rl:<class>:usr:<dbUserId>` for JWT users,
  `rl:<class>:aak:<agentKeyId>` for agents.
- **Per-site:** `rl:<class>:site:<siteId>` — the aggregate ceiling that protects Postgres
  when one site's many tokens (or its renderer traffic) sum to trouble. Both checks must
  pass.
- **Concurrency (DO):** key `site:<siteId>:class:<class>`, semaphore with N slots,
  acquire/release around the handler (`release` in `finally` + a DO alarm as leak
  backstop). One new DO class (`RateLimiterDO`, SQLite), one `new_sqlite_classes`
  migration. Only on expensive-listing and execute-job, so the added DO round trip lands
  exclusively on requests that cost 100x the overhead.

### Cost weighting

Route cost is expressed by **class-specific limits in separate binding namespaces** (the
PCC-3192 pattern), not by multiplying `limit()` calls. The taxonomy is a pure function
`classifyRoute(route.handler, route.params, method)` over the existing parsed route —
`route-parser.ts` already yields everything needed (`handler`, `action`,
`versionsPath`, method). New routes default to `cheap-read` (fail-safe: a missed
classification under-limits, never over-limits).

---

## 4. Route-class taxonomy and default limits

Classes map from `route.handler` + method (handlers from `src/routes/route-parser.ts`).
Numbers are **starting points for log-only mode**, chosen against measured incidents
(tooling sweep averaging ~3.2 rps over its hour with ~11.6 rps 5-min peaks; ~20 s pathPrefix listing queries; 5–7 queries per
uncached content 200, 3 per 404). Tune from shadow data before enforcing.

| Class | Routes (handler/action) | Why this cost | Per-actor default (60 s) | Per-site default (60 s) | Concurrency (DO) |
|---|---|---|---|---|---|
| **serve-content** | `content` (`content`, `content-pages` GET), `content-redirects` | 5–7 queries per uncached 200; charged on **cache miss only** (gate in `CachedContent`) | renderer token: none (site cap governs) | 600 misses/min, burst-tolerant | — |
| **cheap-read** | `documents` GET single / `versions/latest` / `versions` by-id, `branches` GET, `sites` GET, `metadata` GET, `presence` GET, `templates` GET, `structures` GET, `nodes` GET | 1–4 point lookups | 300/min (5 rps — the incident sweep averaged ~192/min over its hour with 5-min peaks of ~694/min; this cap clips the peak buckets, which carried 68% of the flood volume) | 1200/min | — |
| **expensive-listing** | `documents` list w/ `pathPrefix`, `content-pages` (uncached path), `versions` list, `queries`, `drift`, `site-export` GET | up to 20 s query time; the 48%-of-DB-time endpoint | 30/min | 60/min | **2 per site** |
| **write** | `documents` PUT/POST/PATCH/DELETE, `publish`, `metadata`/`nodes`/`redirects` writes, `checkpoints`, `datasources` | writes + purge fan-out (1134 pressure) | 120/min | 300/min | — |
| **execute-job** | `merge` execute, `site-import`, `migrations`, `backfill-datasources`, `site-screenshot` POST | minutes-long, transactional | 6/min | — | **1 per site** |
| **auth-admin** | `site-tokens`, `grants`, `collaborators`, `admin-users`, `agent-keys`, `agent-roles`, `site-settings`, `organization`, `users` | low volume, sensitive | 60/min per user | — | — |
| **realtime-connect** | `realtime` upgrade | DO session setup | 30 connects/min per user | 120/min | — |

Notes:

- The GCLB 30 s WebSocket kill means healthy editors reconnect ~2/min **by design**; the
  realtime-connect cap must sit well above (reconnect storm ≠ abuse — see failure table).
- Dashboard bursts (branch switch fires many parallel reads) shaped fine under
  cheap-read 300/min in the traces we have; verify in shadow mode.
- Bindings are per-env with disjoint `namespace_id` series, exactly as the css-mcp-server
  comment block prescribes (counters are account-scoped; staging and production must not
  share buckets). Suggested series: `37xx1yy` prod / `37xx2yy` staging / `37xx3yy` local.
- **Internal bypass:** `/internal/*` (X-Internal-Secret) is already outside the gate.
  Service-binding callers are indistinguishable from external ones at the fetch handler,
  so bypass is by credential class: `aak_` keys used by css-mcp-server get a generous
  dedicated budget (it already self-limits), p1-media's calls should carry the internal
  secret or a dedicated header set at the binding call site. p1-agent currently public-
  fetches workers.dev and should move to a service binding (adjacent recommendation).

---

## 5. Customer-facing 429 contract

Designed to be discovered and obeyed mid-session by an LLM agent (the flooding client is
Claude-driven Node tooling).

- **Status:** `429` with `Retry-After: <seconds>` (integer, jittered ±20% server-side to
  break retry synchronization).
- **Headers on every limited-class response** (deterministic, IETF draft names):
  `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds), plus
  `RateLimit-Policy: <limit>;w=60`. The binding does not expose remaining-count, so
  Remaining is emitted as exact where the DO is authoritative and omitted (not faked)
  where only the binding is consulted — deterministic beats complete.
- **Body** (same envelope as existing `errorResponse`):

  ```json
  {
    "error": "rate_limited",
    "message": "Rate limit exceeded for expensive-listing requests on this site. Wait 32 seconds, then retry. Reduce polling: fetch document lists once and use per-document reads, or the bulk state endpoint.",
    "limitClass": "expensive-listing",
    "scope": "site",
    "retryAfterSeconds": 32,
    "docs": "https://ccr.p1.pantheon.io/docs#rate-limits"
  }
  ```

  The `message` is written for an agent: what tripped, how long to wait, and what to do
  differently — mirroring `formatRateLimitError` in css-mcp-server, which the same
  customer's tooling already parses successfully.
- **Documentation:** a rate-limits section in the OpenAPI served at `/docs` (already
  public), listing classes, windows, and header semantics.
- **The carrot (adjacent recommendation, not designed here):** a bulk document-state
  endpoint (one call replacing N `versions/latest` polls — the incident was 535 docs
  polled individually) and a `If-None-Match`-friendly cheap change-cursor. The 429 body's
  remediation text should point at these once they exist; limits alone teach clients to
  retry, alternatives teach them to stop polling.
- 429s are never cached (`Cache-Control: no-store`) and OPTIONS preflight is never
  limited (`shouldBypassRateLimit` precedent).

---

## 6. Failure modes

| Failure | Behavior | Rationale |
|---|---|---|
| Rate Limiting binding missing/undefined | **fail open**, warn once per binding per isolate (copy `warnMissingBindingOnce`) | availability > enforcement; drift visible in logs |
| DO semaphore call errors or exceeds 150 ms | **fail open** (race with timeout), log `rate_limit.decision=error_open` | a limiter must never add an outage; 150 ms bounds worst-case added latency |
| DO semaphore leak (handler dies before release) | DO alarm sweeps slots older than the class's max runtime | prevents permanent starvation of execute-job |
| CONFIG_KV config unreadable | fall back to compiled defaults (wrangler `vars`), fail open to defaults — never closed | config plane outage must not change enforcement posture |
| Renderer false-positive lockout | renderer uses its own sat_ token ⇒ per-token override multiplier set high at onboarding; per-site kill-switch flips its site to log-only in ≤60 s (KV TTL); serve-content is site-capped, not renderer-token-capped | the one lockout that takes a customer's production site down |
| Thundering herd after 429 | jittered Retry-After; denies cost no DB (binding/DO only), so a retry storm hits the limiter, not Postgres | the limiter is itself the cheap absorber |
| WebSocket reconnect storm (GCLB 30 s kill) | connect cap 30/min/user ≫ the ~2/min steady state; **never** terminate or 429 an established session; cap only new upgrades | punishing reconnects would turn a GCLB artifact into an editing outage |
| Zone-WAF false positive (L5, post-zone; replaces the former Cloud Armor row — §8a) | edge thresholds set ~10x above L1 so L1 always trips first with its contract headers; the zone layer catches only what never authenticates (crawlers, unauthenticated floods) | keeps the customer-visible contract at one layer |
| Limiter DO colo outage | binding checks still enforce rate caps; only concurrency caps degrade to open | partial protection beats none |

---

## 7. workers.dev bypass lockdown

Today both env URLs are publicly reachable and GCLB proxies to them, so L2/L5 edge rules
are bypassable. L1 is not — which buys time to do lockdown properly. Plan, in order:

1. ~~**Now (no topology change):**~~ **Superseded by §8a (zone-first) — do not build; retained only as fallback if the zone slips.** Original plan: Cloudflare **Access service tokens** on the workers.dev
   route (one-click Access for Workers, available since 2025-10). GCLB injects
   `CF-Access-Client-Id`/`-Secret` via `custom_request_headers` on the backend service
   (Terraform in pantheon-content-cloud); the renderer default already points at the GCLB
   hostname so it needs nothing; direct-URL callers (p1-agent staging, any customer who
   hard-coded workers.dev) get service tokens or migrate to the public hostname.
   Unauthenticated junk then dies at Cloudflare's edge **before invoking the worker** —
   this is also the cheapest fix for junk-404 invocation cost.
   Alternative if Access is unavailable on the account: a shared-secret header injected
   by GCLB and checked first thing in `fetch` (weaker: still invokes the worker; secret
   rotation is manual).
2. **Verify preview URLs are off.** Since wrangler v4.44 `preview_urls` follows the
   workers.dev setting, but our configs predate that — set `"preview_urls": false`
   explicitly when touching lockdown (it defaults from `workers_dev`, which we have not
   set either).
3. **Post-zone (§8):** custom domains on the zone, then disable `workers_dev` outright.
   Do not disable workers.dev before GCLB stops depending on it as the backend.

Worker names stay frozen throughout — nothing here renames anything.

---

## 8. Cloudflare zone migration: cost/benefit *(analysis retained; sequencing superseded by §8a)*

**Original recommendation (superseded by §8a, zone-first adopted 2026-08-21): yes,
pursue it — as its own initiative on its own timeline, after L1 ships.** The analysis
below stands; the sequencing conclusion flipped when the migration timeline firmed up to
days-to-weeks. Original rationale — it is the right end-state but the wrong first move: it delivers no protection
for the dominant abuse pattern (authenticated per-token floods are invisible to WAF IP
heuristics) and its benefits are a bundle mostly orthogonal to rate limiting.

**What a zone buys (in rough order of value to us):**

1. **WebSockets that survive.** CF-proxied zones hold long-lived WebSockets; replacing
   GCLB on the realtime path removes the 30 s session kill — arguably the biggest
   single UX win, and it is not a rate-limiting benefit at all.
2. **Real client IPs at the edge.** Only post-zone does `CF-Connecting-IP` mean anything
   for public traffic; L5 WAF rate-limiting rules, IP lists, and bot management become
   usable, and the css-mcp-server per-IP buckets start keying correctly.
3. **Zone cache + purge-by-tag/hostname/prefix** (Enterprise): a second cache tier in
   front of serve-content with a real invalidation API — directly relevant to the
   (now-fixed) PCC-3715 purge-scope bug's blast radius and the error-1134 purge-rate
   pain (zone purge quotas are far above the Workers-API path we hit 1134 on). The purge
   fix shipped (#125, deployed 08-20); 1134 is the remaining live constraint. The zone
   improves headroom, it is not the fix.
4. WAF managed rules / DDoS on the API hostnames; Security Analytics for free-tier
   visibility into what GCLB currently hides from us.

**What it costs / risks:**

- **DNS + plan mechanics.** `pantheon.io`'s DNS lives outside Cloudflare. Options:
  partial (CNAME) setup for the `*.p1.pantheon.io` hostnames (needs Business+), an
  Enterprise subdomain zone for `p1.pantheon.io`, or moving the hostnames to a new
  dedicated domain. Each needs the CF account team conversation before we can even
  schedule this (open question Q1).
- **Terraform surgery in pantheon-content-cloud** (GCLB, DNS records, certs) with a
  live-traffic cutover. Worker names are frozen and referenced by that Terraform; custom
  domains attach by hostname→worker mapping, no renames — but the GCLB backend-service
  wiring changes or disappears.
- **GCLB's fate:** after the zone fronts the workers, keeping GCLB in path
  (client → CF → GCLB → workers.dev) buys nothing and adds a hop, double-proxy XFF
  confusion, and the 30 s WS kill back. Recommendation: post-zone, GCLB leaves the
  serving path for these hostnames entirely (client → CF zone → worker via custom
  domain), and Cloud Armor's role is retired in favor of zone WAF. Interim Cloud Armor
  spend (L2) is therefore deliberately small — rules we are willing to throw away. *(Moot under §8a — L2 is never built.)*
- **Migration risk:** cert cutover, cache-cold start, any customer allowlisting our GCLB
  IPs breaks. Needs staging rehearsal on `staging.ccr.p1.pantheon.io` first.

**Sequencing (original, superseded):** L1 (in-worker) and L4 are unaffected by the zone
either way — they are hostname-independent. That is precisely why they go first: nothing
in this design creates pressure to rush the zone decision, and nothing is wasted if the
zone lands next quarter.

## 8a. Zone-first variant — ADOPTED 2026-08-21

Platform lead's call: the zone migration is a **days-to-weeks** effort, not quarters.
That flips the §8 sequencing — the original "L1 first, zone later" logic rested on the
zone not addressing the measured per-token abuse, which is (a) weakened on Enterprise
tier and (b) partially wrong even at per-IP: the entire 2026-08-20 incident sweep
came from **a single client IP** (24.22.229.43, ~11.6 rps at peak), which plain
post-zone per-IP rules would have dampened. With a short zone timeline, interim scaffolding is waste.

**What zone-first deletes from this plan:**

1. **L2 Cloud Armor** — never built. Zone WAF rate-limiting rules own the edge.
2. **L3 Access-token workers.dev lockdown** — replaced by the structural fix: zone
   routes/custom domains for the workers, `workers_dev: false`, and all internal callers
   on service bindings (the p1-agent public-fetch finding graduates from "flagged" to
   "prerequisite").
3. **All XFF gymnastics** — CF becomes the first hop; `CF-Connecting-IP` is the real
   client. Per-IP limiting, IP lists, and bot management become meaningful, and the
   css-mcp-server one-bucket bug is fixed by topology (its per-IP keying becomes correct).
4. **The GCLB 30 s ceiling** on every zone-fronted hostname — editor WebSockets stop
   dying at 30 s (~1,350 kills/day documented since the 08-07 investigation); REST
   windows stop being 30 s. (The merge job runner remains correct design regardless —
   never depend on window length.)

**What zone-first adds beyond rate limiting:** bot management/challenges — **qualified:
only for direct-to-API abuse.** Render-path traffic arrives as UA `node` from the
customer's SSR (load review, finding 9), so our zone's bot management can never shed
crawler-driven render load; that class is owned by R2 materialization plus the per-site
serve budget. Also: Bulk Redirects (resolves materialized-views open Q10 natively at 10k+ entries);
zone Cache Rules in front of the worker or an R2 custom domain; DDoS; per-hostname
analytics; one less proxy hop.

**What it does NOT replace — L1's irreducible core ships regardless:** the two DO
semaphores (concurrency is not expressible as WAF request-rate), validated-identity /
per-site semantics, service-binding lanes (never cross the zone), the 429
contract + p1Logger observability. First ship = semaphores + 429 contract + shadow
logging; binding-based per-token caps follow behind the zone's edge rules.

**Gate #1 (first action item): confirm the zone's plan tier with the CF account team.**
Per-token counting at the edge (rate rules keyed on the `x-api-key` header) requires
Advanced Rate Limiting (Enterprise). On Business tier, edge rules are effectively
per-IP — still valuable post-zone (real IPs), but per-token stays exclusively L1's job.
This answers open question Q1 and determines how much of the taxonomy the edge can carry.

**Scope:** delegate `p1.pantheon.io` as its own CF zone (main pantheon.io DNS untouched)
or partial/CNAME setup — the account-team conversation decides which. Only the API/CCR
hostnames move; customer domains pointing at the renderer can stay on GCLB initially.
Post-cutover, GCLB leaves the serving path for these hostnames (per the GCLB's-fate
analysis above). Staging rehearsal on `staging.ccr.p1.pantheon.io` first, as originally
specified.

---

## 9. Configuration, observability, rollout

**Config resolution (per request, cheap):**

1. Compiled defaults per class (wrangler `vars`, per env) — always present.
2. **Global/per-class mode + kill-switch in `CONFIG_KV`** (already bound):
   `rate-limit:mode` = `off | log | enforce`, plus optional per-class and per-site
   `rate-limit:site:<siteId>` docs. Read with `cacheTtl: 60` — effectively free, changes
   propagate in ≤60 s, and **KV is writable in an incident without a deploy** (the
   kill-switch requirement).
3. **Per-site overrides in `sites.settings` JSONB** (`site-settings-service.ts` pattern:
   a `rateLimits` key with per-class multipliers), read through a per-isolate memoized
   cache (the PCC-3712 `memoizedLookup` pattern) so overrides cost no extra DB reads.
   This is where "this enterprise customer gets 5x" lives, next to `cacheTtlMain`, and is
   editable via the existing site-settings API.

**Observability (p1Logger, never console.*):** one structured log line per rate-limit
decision that is not a plain allow, via `getLogger().info/warn`:
`rate_limit.class`, `rate_limit.scope` (`token|user|site|concurrency`),
`rate_limit.decision` (`deny | would_deny | error_open`), `rate_limit.mode`,
`rate_limit.key_hash` (hashed key — never a raw token), `site_id`, `retry_after_s`.
Plus counters through the existing metrics service:
`css_rate_limit_decisions_total{class, scope, decision}`. Note prod runs
`LOG_LEVEL=warn`: `would_deny`/`deny` must log at `warn` or they are invisible exactly
when we need them (the same trap the purge logs hit — see cache-remediation plan §3709).

**Rollout:**

1. **Shadow (log-only) everywhere** — bindings + classifier + logging, `mode=log`,
   generous defaults. Run ≥1–2 weeks; tune from `would_deny` against known-legit clients
   (renderer token, dashboard, MCP).
2. **Enforce expensive-listing + execute-job** (highest DB relief, narrowest blast
   radius; the DO semaphore lands here). This alone would have blunted both the
   pathPrefix flood and the merge-vs-poll self-collision.
3. **Enforce cheap-read per-token**, with the customer notified and the 429 contract
   documented at `/docs` first — this is the layer their tooling will actually meet.
4. **Enforce serve-content per-site miss budget** last (renderer-adjacent, so most
   false-positive-sensitive) — sequence against whichever miss shield actually ships:
   PCC-3711's allowlist if it survives, or the R2 materialization rollout that
   supersedes it (see the materialized-views design §8; R2 misses cost zero DB).
5. ~~Cloud Armor L2 and Access lockdown L3 proceed in parallel~~ **Superseded by
   zone-first (§8a):** the zone-migration track proceeds in parallel instead — account-
   team tier conversation (Gate #1), staging rehearsal, hostname cutover, then zone WAF
   rules and `workers_dev: false`.
6. Per-site overrides + kill-switch are part of step 1's scaffolding, not an afterthought.

---

## 10. Interactions with in-flight work

- **PCC-3712/3709/3711/3710 (cache remediation):** complementary, not competing — they
  shrink per-request DB cost; this bounds request volume. Order-insensitive except step 4
  above (serve-content enforcement sequences against whichever miss shield ships — 3711 if it survives, or the R2 materialization that supersedes it; see §9 step 4).
- **R2 materialization (sibling architecture effort):** owns the render-storm fix;
  serve-content limits here are defense-in-depth and their thresholds should be revisited
  (loosened) once serving comes off Postgres.
- **PCC-3715 (purge entrypoint bug — fixed & deployed 2026-08-20, #125):** unrelated
  mechanism; pre-fix miss rates were inflated by never-evicted entries being repopulated,
  so tune serve-content budgets from post-fix data only.
- **PCC-3676 (cross-site access):** per-token + per-site dual keying means a token
  wandering across sites burns its own budget on each site — a small containment bonus
  on top of PR #112's actual fix.
- **css-mcp-server per-IP keying:** fix `getClientIp` to prefer the GCLB-appended XFF
  hop (rightmost trusted entry) over `CF-Connecting-IP` when the request arrives via
  GCLB; otherwise all MCP users share IP buckets (latent false positive as usage grows).
- **Large-MR execute wall (Cellar Door):** execute-job concurrency 1/site formalizes
  what the merge path already needs; the real fix (job decomposition) is that effort's
  scope. **Interplay once the job runner ships:** the runner serializes per-MR itself
  and the execute route then returns in ≤15 s, so a semaphore held around the HTTP
  handler no longer bounds background merge concurrency — this semaphore's job narrows
  to bounding trigger rate, and any per-site cap on *running jobs* belongs to the
  runner (its open question), not this layer.

## 11. Open questions

1. **CF plan level** — which zone setup (partial CNAME / Enterprise subdomain zone) and
   whether Access, bot management, and purge-by-tag are available on the current
   accounts. Blocks §8 scheduling and part of §7 step 1. (Account-team conversation.)
2. **Cloud Armor + internet-NEG backends** — confirm rate-based ban rules are supported
   on the serverless/internet NEG backend type our GCLB uses, and where in the XFF chain
   its per-IP key reads. (pantheon-content-cloud Terraform owner.)
3. **Renderer identification** — is the renderer's sat_ token distinguishable from
   customer-created tokens today (naming convention only)? A `system`-flagged token or
   dedicated scope would make the override rule in §6 robust instead of conventional.
4. **RateLimit header set** — standardize on draft-07 split headers (as written) or the
   newer combined `RateLimit:` field? Decide once, before customer docs publish.
5. **Should end-client IP cross the renderer?** If p1-next-sdk forwarded a
   `True-Client-IP`, the worker could key crawler traffic per end-client. Deliberately
   out of scope here (R2 materialization likely moots it) — but record the option.
6. **Where does the customer contract get published** — `/docs` OpenAPI only, or also
   the product docs site? Needs a docs owner.
