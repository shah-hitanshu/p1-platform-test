# Cost Model: 50K Sites Milestone

**Date:** 2026-03-03
**Status:** Draft estimate
**Context:** Prospective monthly costs at 50,000 sites using Cloudflare Workers/DOs/Queues and GCP Cloud SQL, with all Phase 1-6 scaling optimizations applied.

---

## Load Assumptions

Scaled from SCALING-PLAN.md load model (designed for 1M sites, applied at 50K).

```
50,000 total sites
× 1% concurrently active at peak          =    500 active sites
× ~10 documents being edited per site      =  5,000 active DOs (peak)
× 5 avg editors per document               = 25,000 WebSocket connections (peak)

Average across 24h (not all sites peak simultaneously):
  ~1,000 unique active sites/day, ~6h editing each
  ~1,500 average concurrent DOs
  ~8,000 average concurrent connections
  ~270,000 DO-hours of editing activity/month
```

### Editing Activity

- Active editor sends ~2 msg/sec average (typing + cursor + operations)
- Average editors per active DO: 3 (not all 5 simultaneously typing)
- Messages per active DO per second: ~6
- Editing concentrated in ~6 hours/day per site

### Derived Monthly Volumes

| Metric | Volume |
|--------|--------|
| WebSocket messages (incoming) | ~15.5B |
| DO billed requests (WS at 20:1) | ~780M |
| Sync queue messages | ~215M |
| HTTP API requests | ~240M |
| DO SQLite writes (debounced persist) | ~500M |

---

## Measured Document Sizes

From Airbus Migration site (real content, main branch, latest versions):

| Document | Components | Snapshot JSON | CRDT State (raw) | CRDT (base64) | Queue Message | PG Row (compressed) |
|----------|-----------|---------------|-------------------|---------------|---------------|---------------------|
| ach135 | 17 | 15 KB | 21 KB | 29 KB | 44 KB | 20 KB |
| ach160 | 13 | 12 KB | 38 KB | 52 KB | 65 KB | 23 KB |
| home | 12 | 13 KB | 24 KB | 33 KB | 44 KB | 18 KB |
| **Average** | **14** | **13 KB** | **28 KB** | **38 KB** | **~50 KB** | **20 KB** |

### Per-Component Scaling (measured)

| Metric | Per Component |
|--------|--------------|
| Snapshot JSON | ~790 bytes |
| CRDT state (raw) | ~1,116 bytes |

### Extrapolated to Target Document Sizes

| Document Size | Components | Snapshot | CRDT (raw) | Queue Msg | PG Row | Exceeds 64KB? |
|--------------|-----------|----------|------------|-----------|--------|---------------|
| Small | 15 | 12 KB | 17 KB | 33 KB | 20 KB | No |
| Medium | 50 | 39 KB | 55 KB | 114 KB | 71 KB | Yes |
| Large | 100 | 77 KB | 109 KB | 228 KB | 142 KB | Yes |
| Very Large | 200 | 154 KB | 218 KB | 453 KB | 284 KB | Yes |

> **Note:** CRDT state grows ~25% over 19 edit versions (measured). Documents with extensive edit history accumulate larger CRDT state independent of component count. The Demo Site `test` document (only ~5 components) has 96 KB CRDT state due to edit history.

### Cloudflare Queues 64 KB Billing Threshold

Queue operations are billed per 64 KB chunk. A 114 KB message costs 2 operations per write/read/ack (6 total instead of 3). This is the primary cost multiplier for larger documents.

| Document Size | Queue ops per message (write+read+ack) |
|--------------|---------------------------------------|
| Under 64 KB | 3 |
| 64-128 KB | 6 |
| 128-192 KB | 9 |
| 192-256 KB | 12 |
| 256-512 KB | 24 |

---

## Scenario A: Airbus-Sized Documents (~15 components avg)

All documents average ~42 KB queue payload, under 64 KB threshold.

### Cloudflare Costs

| Service | Line Item | Monthly Volume | Included | Overage | Rate | Cost |
|---------|-----------|---------------|----------|---------|------|------|
| Workers | Base plan | — | — | — | $5/mo | **$5** |
| Workers | Requests | 240M | 10M | 230M | $0.30/M | **$69** |
| Workers | CPU time | 480M ms | 30M ms | 450M ms | $0.02/M ms | **$9** |
| DOs | Requests (WS 20:1) | 780M | 1M | 779M | $0.15/M | **$117** |
| DOs | Duration (GB-s) | 4M | 400K | 3.6M | $12.50/M | **$45** |
| DOs | SQLite rows read | 5M | 25B | 0 | $0.001/M | **$0** |
| DOs | SQLite rows written | 500M | 50M | 450M | $1.00/M | **$450** |
| DOs | Stored data | 12 GB | 5 GB | 7 GB | $0.20/GB | **$1** |
| Queues | Operations (3/msg) | 646M | 1M | 645M | $0.40/M | **$258** |
| KV | Reads | 10M | 10M | 0 | $0.50/M | **$0** |
| KV | Writes | 500K | 1M | 0 | $5.00/M | **$0** |
| Hyperdrive | Pooling + caching | unlimited | incl. | — | $0 | **$0** |
| | | | | | **Subtotal** | **$954** |

### GCP Costs

| Service | Details | Cost |
|---------|---------|------|
| Cloud SQL Enterprise 4 vCPU / 16 GB HA | ($0.0413×4 + $0.007×16) × 730h × 2 | **$405** |
| SSD storage 300 GB | $0.222/GB | **$67** |
| Automated backups 300 GB | $0.105/GB | **$32** |
| Network egress ~100 GB | $0.12/GB | **$12** |
| | **Subtotal** | **$516** |

### Scenario A Total: **~$1,470/month** ($0.029/site)

---

## Scenario B: Production Document Mix

Assumes realistic distribution once sites are actively building pages:

| Segment | % of Active Docs | Components | Queue Ops/Msg |
|---------|-----------------|------------|---------------|
| Small pages | 40% | ~15 | 3 |
| Medium pages | 35% | ~50 | 6 |
| Large pages | 20% | ~100 | 12 |
| Very large pages | 5% | ~200 | 24 |
| **Weighted average** | | **~55** | **~6.6** |

### Changed Line Items (vs Scenario A)

| Line Item | Scenario A | Scenario B | Delta | Reason |
|-----------|-----------|------------|-------|--------|
| Queues operations | $258 | **$568** | +$310 | 6.6 ops/msg avg vs 3 |
| GCP SSD storage | $67 | **$156** | +$89 | ~700 GB (larger rows) |
| GCP backups | $32 | **$74** | +$42 | 700 GB |
| GCP egress | $12 | **$24** | +$12 | Larger query responses |
| All other items | $1,101 | $1,101 | — | Unaffected by doc size |
| **Total** | **$1,470** | **$1,923** | **+$453** | |

### Scenario B Total: **~$1,923/month** ($0.038/site)

---

## Cost Breakdown by Category (Scenario B)

| Category | Cost | % of Total |
|----------|------|------------|
| Cloudflare Durable Objects | $613 | 32% |
| Cloudflare Queues | $568 | 30% |
| GCP Cloud SQL (compute) | $405 | 21% |
| GCP storage + backups + egress | $254 | 13% |
| Cloudflare Workers | $83 | 4% |
| KV + Hyperdrive | $0 | 0% |
| **Total** | **$1,923** | 100% |

### Top 5 Cost Drivers

| Rank | Item | Cost | % | Notes |
|------|------|------|---|-------|
| 1 | Queues operations | $568 | 30% | Driven by messages exceeding 64 KB |
| 2 | DO SQLite writes | $450 | 23% | Debounced persistence every 2s |
| 3 | GCP Cloud SQL HA | $405 | 21% | 4 vCPU / 16 GB with HA |
| 4 | GCP storage + backups | $230 | 12% | 700 GB SSD + backup |
| 5 | DO requests | $117 | 6% | WebSocket messages at 20:1 |

---

## Cost Optimization Opportunities

### High Impact

| Optimization | Current Cost | Projected | Savings | Effort |
|-------------|-------------|-----------|---------|--------|
| **Omit CRDT state from queue messages** | $568 (queues) | ~$258 | **$310/mo** | Medium |
| Increase persist debounce (2s → 5s) | $450 (writes) | ~$270 | **$180/mo** | Low |
| GCP 3-year CUD | $405 (compute) | ~$195 | **$210/mo** | Contract |
| Compress CRDT state before base64 | $568 (queues) | ~$340 | **$228/mo** | Medium |

> **Note:** "Omit CRDT state" and "Compress CRDT state" are mutually exclusive — pick one.

### Medium Impact

| Optimization | Savings | Effort |
|-------------|---------|--------|
| GCP 1-year CUD (25% compute discount) | $100/mo | Contract |
| `RETURNING *` → `RETURNING id` in batch sync | $10-50/mo | Low |
| Reduce sync frequency under low activity | $80/mo | Medium |

### Investigation Needed

**Should the full CRDT edit history be sent through the sync queue?**

The queue message currently includes `Y.encodeStateAsUpdate(this.ydoc)` — the complete CRDT history, not just current state. This is the dominant factor in message size. The snapshot JSON alone (4-154 KB depending on components) is always smaller and is what PostgreSQL uses for version history, branching, and merges.

The CRDT binary state is only needed for Yjs merge operations, which happen in the DO (in-memory), not in PostgreSQL. If the queue only sends snapshot JSON, messages shrink dramatically and all stay under 64 KB.

**Files:** `document-session.ts:2620-2634` (queue payload), `sync-consumer.ts`, `document-version-service.ts` (batchSyncToPostgres), `document-session.ts` (initializeFromPostgres — reads crdt_state on cold start).

See `memory/cost-optimization-notes.md` for full investigation notes.

---

## Pricing Sources

All prices based on published rates as of March 2026:

- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cloudflare Hyperdrive Pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [GCP Cloud SQL Pricing](https://cloud.google.com/sql/pricing)

---

## Assumptions & Caveats

1. **Concurrency model** uses the SCALING-PLAN.md 1% concurrent active rate. Actual usage patterns at 50K sites may vary.
2. **Document size distribution** in Scenario B is estimated. Real distribution depends on customer content complexity.
3. **CRDT state growth** is modeled at ~25% over 19 versions. Documents with heavy editing (hundreds of versions) will have proportionally larger CRDT state.
4. **GCP pricing** uses on-demand rates for us-central1. Sustained-use discounts apply automatically but are not modeled.
5. **Agent workflows** (batch edits, checkpoints) are not separately modeled — their cost is included in the general sync and DO activity volumes.
6. **Cloudflare enterprise pricing** may differ from published rates. Contact your account team for volume discounts.
