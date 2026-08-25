# Scaling Plan: High Concurrency Editing & Presence

**Date:** 2026-03-01
**Status:** Decisions Resolved — Ready for Implementation
**Scope:** Address scaling bottlenecks identified in Durable Objects and DO-to-PostgreSQL integration review for high concurrency editing, presence tracking, and agentic workflows.

---

## Design Goals

| Goal | Target |
|------|--------|
| Total sites | Millions |
| Documents per site | 2,000+ |
| Realtime editors per document | Average 5, maximum 50 |
| Agentic workflows | Batch updates across hundreds of documents per operation |

## Executive Summary

A review of the DocumentSession Durable Object implementation and the DO-to-PostgreSQL sync pipeline identified two categories of scaling challenges:

1. **DO-internal bottlenecks:** O(N^2) broadcast work per edit, per-keystroke persistence, fan-out presence queries, and missing rate limiting.

2. **DO-to-PostgreSQL connection scaling:** Every sync from a DO takes an HTTP round-trip back through the Worker, creates a new `postgres()` client via Hyperdrive, runs 2-3 queries, then tears down the connection. At target scale (~100,000 concurrently active DOs), this produces ~20,000 sync requests/second requiring ~1,000 concurrent Hyperdrive connections — 10x over the ~100-connection limit. Checkpoint operations for agent workflows on 2,000-document branches hold connections for 5-10 seconds each.

PostgreSQL remains the correct choice for the persistence layer. The data model is deeply relational (branches span documents, checkpoints snapshot entire branches, merge requests compare branches) and relies on PostgreSQL-specific features: JSONB, DISTINCT ON, BYTEA, uuid-ossp, TEXT[], typed casts, and multi-table transactions. Cloudflare-native alternatives (D1, DO SQLite) cannot replace this — D1 is single-threaded with no JSONB operators, and DO SQLite has no cross-DO query capability. The scaling fix is in the **connection architecture**, not the database engine.

This plan organizes fixes into 6 phases, ordered by impact and dependency.

---

## Load Model at Target Scale

### Steady-State Concurrency

```
1,000,000 total sites
× 1% concurrently active                    =    10,000 active sites
× ~10 documents being edited per site        =   100,000 active DOs
× 5 avg editors per document                 =   500,000 WebSocket connections
```

### PostgreSQL Sync Load (Current Architecture)

```
100,000 active DOs
÷ 5s sync debounce (SYNC_IDLE_TIMEOUT_MS)    =   20,000 sync requests/s
× ~50ms connection hold per sync              =    1,000 concurrent connections needed
                                              vs     100 Hyperdrive connection limit
                                              ─────────────────────────────────────
                                              Result: 10x over capacity
```

### Agent Workflow Load

| Scenario | DOs Touched | DB Operations |
|----------|-------------|---------------|
| Agent edits 1 document | 1 | 2 checkpoints + 1 sync |
| Agent batch-updates 200 docs on a branch | 200 | 2 checkpoints (each snapshots **all 2,000 docs**) + 200 syncs |
| 10 concurrent agents across org | 2,000 | 20 checkpoints + 2,000 syncs |

Each checkpoint on a 2,000-doc branch currently executes 6 queries inserting 2,000+ rows and holds a connection for 5-10 seconds. A `revertToCheckpoint()` runs 2,000 sequential INSERT statements in a loop.

---

## Phase 1: DO-Internal Optimizations (Low Risk, High Impact)

These changes are internal to the existing DocumentSession DO and don't affect external APIs or data formats. They reduce per-message CPU and I/O without architectural changes.

### 1.1 Debounce DO Storage Persistence

**Problem:** `persist()` is called on every WebSocket message (`document-session.ts:1190`), serializing the full Yjs document and writing to storage on every keystroke. With 50 editors at 5 keystrokes/sec = 250 storage writes/second per DO.

**Change:**
- Add a `persistPending` flag and `PERSIST_DEBOUNCE_MS` constant (e.g., 2000ms)
- On each `webSocketMessage()`, set the flag instead of calling `persist()` directly
- Use the existing alarm mechanism to flush pending persistence
- Always persist on WebSocket disconnect (already done) and on `/apply` HTTP endpoint (critical for agent edits)
- The Yjs doc remains the authoritative in-memory state; storage is a durability checkpoint

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — `webSocketMessage()`, new debounce logic in alarm handler
- `workers/src/constants/security-limits.ts` — add `PERSIST_DEBOUNCE_MS`

**Risk:** If the DO crashes between edits and the next persist, a few seconds of edits could be lost. This is acceptable because:
- Connected clients still have the data and will re-sync
- CRDTs handle reconnection gracefully
- The alternative (persisting every keystroke) makes high concurrency unworkable

**Tests:**
- Verify persistence happens within debounce window
- Verify persistence happens immediately on disconnect
- Verify data survives DO restart after debounced persist

### 1.2 Debounce WebSocket Broadcasts

**Problem:** Every incoming Yjs update is immediately broadcast to all N-1 other connections, creating O(N^2) network work across all editors.

**Change:**
- Batch incoming updates over a short window (e.g., 50ms)
- Merge multiple Yjs updates using `Y.mergeUpdates()` before broadcasting
- Broadcast merged update once to all clients instead of N individual updates
- Use `setTimeout` / microtask batching within the DO's single-threaded context

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — `webSocketMessage()`, new broadcast batching logic

**Risk:** Adds up to 50ms latency to collaborative editing. This is imperceptible to users and significantly reduces CPU/network overhead.

**Tests:**
- Verify batched updates are received by all clients
- Verify update ordering is preserved
- Verify single-editor case has no regression (no unnecessary batching delay)

### 1.3 Delta Encoding for New Connections

**Problem:** New WebSocket connections receive `Y.encodeStateAsUpdate(this.ydoc)` — the full CRDT history. Large documents with extensive history produce multi-megabyte payloads that block the DO while serializing.

**Change:**
- On new connection, send a compacted state snapshot rather than the full history
- Alternatively, use `Y.encodeStateAsUpdate(doc, clientStateVector)` if client provides a state vector via query parameter
- Run `compactCrdtState()` periodically (not just on last disconnect) to keep history bounded

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — `handleWebSocket()`, connect query params, periodic compaction in alarm handler

**Risk:** Minimal. Yjs is designed for this pattern. Clients that connect for the first time get a compacted snapshot which is equivalent to (or smaller than) the full history.

**Tests:**
- Verify new client receives correct document state
- Verify client with existing state vector receives only delta
- Verify periodic compaction reduces serialized size

### Phase 1 Impact

| Metric | Before | After Phase 1 |
|--------|--------|---------------|
| DO storage writes/s (50 editors) | 250 | ~1 (debounced) |
| Broadcast messages per incoming edit | N-1 (49) | 1 merged per 50ms window |
| Total broadcast work (50 editors, 5 edits/s/each) | 12,250 sends/s | ~250 sends/s |
| New client initial payload | Full CRDT history | Compacted snapshot |

---

## Phase 2: Storage Backend Migration (Medium Risk, High Impact)

### 2.1 Migrate from KV to SQLite Storage Backend

**Problem:** The current `wrangler.jsonc` uses `new_classes` instead of `new_sqlite_classes`. The KV backend has a 128 KiB value size limit. Large Yjs documents (2,000-component pages with edit history) will exceed this and fail to persist.

**Change:**
- If not yet deployed to production: change migration to `new_sqlite_classes`
- If already deployed: add migration steps to rename and recreate classes with SQLite backend
- Update `persist()` to store CRDT state in SQLite, enabling:
  - Separate storage for document state, edit sessions, and presence data
  - Larger value sizes (up to 2 MB per key+value)
  - Transactional writes for consistency

**Migration (not yet deployed):**
```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["DocumentState", "PresenceManager", "SessionManager"]
  }
]
```

**Migration (already deployed to some environment):**
```jsonc
"migrations": [
  { "tag": "v1", "new_classes": ["DocumentState", "PresenceManager", "SessionManager"] },
  { "tag": "v2", "deleted_classes": ["DocumentState", "PresenceManager", "SessionManager"] },
  { "tag": "v3", "new_sqlite_classes": ["DocumentState", "PresenceManager", "SessionManager"] }
]
```

> **Decision needed:** Which environments have existing deployments with data that must be preserved?

**Files Modified:**
- `workers/wrangler.jsonc` — migration tags
- `workers/src/durable-objects/document-session.ts` — optionally refactor storage calls to use SQL

**Risk:** Medium. Migration requires careful handling if production data exists. SQLite backend is Cloudflare's recommended approach and provides better performance and higher limits.

**Tests:**
- Verify DO initializes correctly with SQLite storage
- Verify persist/restore roundtrip with documents larger than 128 KiB
- Verify edit sessions and presence data persist correctly

---

## Phase 3: Presence Architecture (Medium Risk, High Impact)

### 3.1 Persist Presence State to DO Storage

**Problem:** PresenceManager is purely in-memory (`presence-service.ts`). When DOs hibernate and wake, presence data (focus regions, activity state, HTTP-only agent presence) is lost. Only WebSocket connection metadata survives.

**Change:**
- Persist focus regions and activity timestamps to DO storage (similar to edit session persistence)
- Add `persistPresence()` and `restorePresence()` methods
- Call `persistPresence()` on focus region updates and heartbeats (debounced)
- Call `restorePresence()` in `initializeIfNeeded()`

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — presence persistence methods
- `workers/src/services/presence-service.ts` — add serialization/deserialization

**Risk:** Low. Follows the same pattern already established for edit sessions.

**Tests:**
- Verify presence survives DO hibernation and wakeup
- Verify focus regions are restored after alarm-triggered wakeup
- Verify stale presence cleanup still works after restoration

### 3.2 Implement Dedicated Presence DO (Eliminates Fan-Out)

**Problem:** `presence-rollup-service.ts` uses fan-out queries to every DocumentSession DO on a branch/site. At target scale with 2,000 docs per site:
- Branch presence query: up to 2,000 DO wakeups
- Site presence query: up to 2,000 × branches DO wakeups
- Agent global presence: traverses all sites, branches, and documents

Each wakeup triggers full `initializeIfNeeded()` which loads the Yjs document from storage.

**Change:**
- Implement the `PresenceManager` DO (currently a placeholder in `index.ts`)
- One PresenceManager DO per site, identified by `siteId`
- DocumentSession DOs **push** presence updates to the site's PresenceManager DO when actors connect/disconnect or change focus regions
- PresenceManager DO maintains an aggregated presence index with:
  - Per-branch summaries
  - Per-document actor lists
  - Agent location index
- Presence API queries go to the single PresenceManager DO instead of fanning out
- Use Durable Object RPC (requires `compatibility_date >= 2024-04-03`) for efficient communication

**Architecture:**

```
┌──────────────────┐     push      ┌────────────────────┐
│ DocumentSession  │──────────────▶│  PresenceManager   │
│ (doc1:branchA)   │               │  (per site)        │
├──────────────────┤     push      │                    │
│ DocumentSession  │──────────────▶│  Aggregated Index: │
│ (doc2:branchA)   │               │  - branch summary  │
├──────────────────┤     push      │  - doc actors      │
│ DocumentSession  │──────────────▶│  - agent locations │
│ (doc3:branchB)   │               │                    │
└──────────────────┘               └────────────────────┘
                                            ▲
                                            │ query
                                   ┌────────┴────────┐
                                   │  Presence API    │
                                   │  (Worker routes) │
                                   └─────────────────┘
```

**Push events from DocumentSession → PresenceManager:**
- `actor_joined` — when a WebSocket connects or agent edit session starts
- `actor_left` — when a WebSocket disconnects or agent edit session ends
- `focus_changed` — when an actor updates focus regions
- `state_changed` — when an actor's presence state changes (active → idle → editing)

**Files Modified:**
- `workers/src/durable-objects/index.ts` — implement PresenceManager DO
- `workers/src/durable-objects/presence-manager.ts` — new file, push-based presence aggregation
- `workers/src/durable-objects/document-session.ts` — add push notifications to PresenceManager
- `workers/src/services/presence-rollup-service.ts` — rewrite to query PresenceManager DO
- `workers/src/routes/presence-api.ts` — update to use new service
- `workers/wrangler.jsonc` — ensure PRESENCE binding is configured

**Risk:** Medium. This is a new DO implementation but follows established patterns. The DocumentSession → PresenceManager push is fire-and-forget (presence is ephemeral), so failures are non-critical.

> **Decision needed:** Should we use RPC methods (preferred, modern) or HTTP fetch for DocumentSession → PresenceManager communication?

**Tests:**
- Verify presence push on connect/disconnect
- Verify aggregated branch/site queries return correct data
- Verify agent global presence query works without fan-out
- Verify PresenceManager handles DO eviction and restoration
- Load test: verify 1,000 concurrent presences across 100 documents aggregate correctly

### 3.3 Retire Fan-Out Presence Rollup

**Depends on:** 3.2 (Dedicated Presence DO)

**Change:**
- Remove fan-out query functions from `presence-rollup-service.ts`
- Update all callers to use the new PresenceManager DO
- Keep `queryDocumentPresence()` as a direct document-level query for cases where only one document's presence is needed

**Files Modified:**
- `workers/src/services/presence-rollup-service.ts` — rewrite
- `workers/src/routes/presence-api.ts` — update service calls

**Risk:** Low once Phase 3.2 is validated.

---

## Phase 4: Rate Limiting & Defensive Measures (Low Risk, Medium Impact)

### 4.1 WebSocket Message Rate Limiting

**Problem:** No per-connection rate limiting exists. A misbehaving client can send rapid messages and monopolize the DO's CPU.

**Change:**
- Track message count and timestamps per actor using WebSocket attachment metadata
- Define `MAX_MESSAGES_PER_SECOND = 50` (allows rapid typing but blocks floods)
- On exceeding the limit, drop messages and send a `presence_error` with code `RATE_LIMITED`
- Optionally close connections that persistently exceed limits

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — `webSocketMessage()` rate check
- `workers/src/constants/security-limits.ts` — add rate limit constants

**Risk:** Low. Only affects abusive clients. Normal editing patterns stay well under 50 messages/second.

**Tests:**
- Verify normal editing is not affected
- Verify rapid messages are rate-limited
- Verify rate limit error message is sent to client
- Verify connection close on persistent abuse

### 4.2 Lazy CRDT Initialization for Presence-Only Queries

**Problem:** The `/presences` endpoint triggers full `initializeIfNeeded()`, including Yjs state loading, just to return actor metadata that doesn't require document content.

**Change:**
- Split initialization into `initializeCrdtIfNeeded()` and `initializeMetadataIfNeeded()`
- Metadata initialization restores: session info, edit sessions, org settings, presence
- CRDT initialization loads and applies the Yjs document (expensive)
- Route `/presences`, `/activity-state`, `/active-agents`, `/edit-sessions` through metadata-only init
- Route `/snapshot`, `/apply`, `/connect`, `/sync` through full CRDT init

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — split `initializeIfNeeded()`

**Risk:** Low. Reduces unnecessary work. Must ensure CRDT is initialized before any operation that touches the Yjs doc.

**Tests:**
- Verify `/presences` works without CRDT initialization
- Verify `/apply` still initializes CRDT correctly
- Verify mixed request patterns (presence then edit) work correctly

---

## Phase 5: DO-to-PostgreSQL Connection Architecture (Medium Risk, Critical Impact)

This phase addresses the primary scaling bottleneck: the connection pathway between Durable Objects and PostgreSQL.

### Current Connection Architecture

```
DocumentSession DO
  └─ fetch("https://worker/internal/crdt-sync")    ← full HTTP round-trip
       └─ Worker fetch() handler                     ← processes as new request
            └─ runWithConnection()                   ← new postgres() client per request
                 └─ Hyperdrive pool                  ← ~100 conn limit (paid plan)
                      └─ PostgreSQL
```

Each DO sync creates a new `postgres()` client instance (`db.ts:110-124`, `max: 1`), performs 2-3 queries, then calls `sql.end()`. At 20,000 syncs/second, this exceeds Hyperdrive's connection pool by 10x.

### 5.1 Queue-Based Sync Decoupling

**Problem:** Direct synchronous sync from DOs to PostgreSQL creates a connection-per-sync model that doesn't scale. With 100,000 active DOs syncing every 5-10 seconds, the connection demand (1,000+) far exceeds Hyperdrive's ~100-connection pool.

**Change:**
Replace the direct HTTP sync path with Cloudflare Queues:

```
DocumentSession DO
  └─ Queue.send({siteId, docId, branchId, snapshot, crdtState, actorId, actorType})
       └─ Queue Consumer (batches of 100 messages)
            └─ 1 Hyperdrive connection per batch
                 └─ Batch INSERT for all 100 document versions
                      └─ PostgreSQL
```

**Implementation details:**
- Add a `SYNC_QUEUE` binding in `wrangler.jsonc` (Cloudflare Queue)
- In `DocumentSession.syncToPostgres()`, replace the `fetch()` call with `env.SYNC_QUEUE.send()`
- Create a Queue consumer Worker that:
  - Receives batches of up to 100 sync messages
  - Opens a single Hyperdrive connection per batch
  - Performs batch INSERT of document versions (single query, not N queries)
  - Handles deduplication (skip unchanged snapshots within the batch)
  - Reports failures back via a dead-letter queue

**Cloudflare Queues capabilities:**
- 5,000 messages/second write throughput per queue
- Batch consumption (up to 100 messages per batch)
- Automatic retry on failure with backoff
- Dead-letter queue for persistent failures
- Multiple consumers for horizontal scaling

**Connection math after queuing:**

```
6,000 sync messages/s (after Phase 1 debounce)
÷ 100 messages per batch
= 60 batch consumers/s
× ~1s connection hold per batch
= ~60 concurrent connections
```

This fits within Hyperdrive's ~100-connection limit with 40% headroom.

**Files Modified:**
- `workers/wrangler.jsonc` — add Queue binding and consumer configuration
- `workers/src/durable-objects/document-session.ts` — replace `syncToPostgres()` HTTP fetch with Queue send
- `workers/src/queues/sync-consumer.ts` — new file, batch queue consumer
- `workers/src/services/crdt-sync-service.ts` — add batch sync function

**Risk:** Medium. Changes sync from immediate (~5s) to eventual (~10-30s) consistency. This is acceptable because:
- The DO's in-memory Yjs doc is the authoritative state during editing
- PostgreSQL is the durability/merge/history layer, not the hot path
- Connected clients always have current state via CRDT sync
- Failure retry is handled automatically by the Queue

> **Decision needed:** Acceptable sync latency? 10-30 seconds is proposed. For agent checkpoint operations, should checkpoints bypass the queue and use direct sync (since they require transactional guarantees)?

**Tests:**
- Verify messages are enqueued on document edits
- Verify batch consumer processes multiple syncs in one connection
- Verify deduplication within batch
- Verify retry behavior on PostgreSQL failure
- Verify document state is eventually consistent after editing stops
- Load test: 10,000 sync messages/second sustained throughput

### 5.2 Consolidate Sync Queries

**Problem:** Each sync operation currently runs 2-3 serial queries on a single connection:
1. `getDocument(documentId)` — SELECT from documents
2. `getLatestDocumentVersion(documentId, branchId)` — SELECT for dedup check
3. `createDocumentVersion(...)` — INSERT with subquery

For batched sync (Phase 5.1), running 3 queries per message in a batch of 100 = 300 queries per connection.

**Change:**
- Combine the dedup check and insert into a single query using PostgreSQL's `INSERT ... ON CONFLICT` or a CTE
- For batch operations, use a single multi-row INSERT with embedded dedup logic
- Pre-validate document existence at the DO level (the DO already knows its document/branch IDs)

**Consolidated single-document sync:**
```sql
WITH latest AS (
  SELECT snapshot FROM app.document_versions
  WHERE document_id = $1 AND branch_id = $2
  ORDER BY version_number DESC LIMIT 1
)
INSERT INTO app.document_versions (
  document_id, branch_id, version_number, snapshot, crdt_state,
  source, created_by_id, created_by_type
)
SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1,
  $3, $4, 'realtime', $5, $6
FROM app.document_versions
WHERE document_id = $1 AND branch_id = $2
  AND NOT EXISTS (
    SELECT 1 FROM latest WHERE latest.snapshot = $3
  )
RETURNING *
```

**Batch sync (for Queue consumer):**
- Use `unnest()` with array parameters to INSERT multiple rows in one statement
- Or use a temporary table + INSERT...SELECT pattern

**Files Modified:**
- `workers/src/services/crdt-sync-service.ts` — consolidated query
- `workers/src/services/document-version-service.ts` — batch insert function
- `workers/src/queues/sync-consumer.ts` — use batch insert

**Risk:** Low. Consolidating queries is a standard optimization. Must verify RETURNING behavior with conditional insert.

**Tests:**
- Verify single-query sync produces correct version numbers
- Verify dedup works within consolidated query
- Verify batch insert handles 100 documents correctly
- Verify concurrent batch inserts don't produce version number conflicts

### 5.3 Direct Hyperdrive Access from DOs (Eliminates HTTP Round-Trip)

**Problem:** Even with queued sync for bulk operations, some DO-to-PostgreSQL calls need to be synchronous:
- `initializeFromPostgres()` on cold start (DO has no local state)
- Agent checkpoint operations (need transactional guarantees)
- Document existence validation

These currently go through a full HTTP round-trip back to the Worker, adding 10-30ms latency and consuming Worker request capacity.

**Change:**
- Add `HYPERDRIVE` binding directly to the DO's environment
- For synchronous DB operations in the DO, use Hyperdrive directly instead of fetching `/internal/*`
- Keep the internal API routes for operations initiated by external clients, but DOs bypass them

**Files Modified:**
- `workers/wrangler.jsonc` — add HYPERDRIVE to DO bindings (if supported) or pass via env
- `workers/src/durable-objects/document-session.ts` — use direct DB queries for init and checkpoints
- `workers/src/db.ts` — ensure connection creation works within DO context

**Risk:** Medium. Must verify that Hyperdrive bindings work within DO context (they do as of 2024). Connection lifecycle within a DO is different from a Worker request — DOs are long-lived, so connection reuse patterns differ.

> **Decision needed:** Can Hyperdrive bindings be shared across DO methods within a single DO instance, or must each method create its own connection? This affects whether we can maintain a DO-scoped connection pool.

**Tests:**
- Verify DO can establish direct Hyperdrive connection
- Verify `initializeFromPostgres()` works via direct connection
- Verify checkpoint operations complete successfully
- Verify connection cleanup on DO hibernation

### Phase 5 Impact

```
                          Current     + Phase 1    + Phase 5
                          -------     ---------    ---------
Sync requests/s           20,000      6,000        6,000 (via Queue)
DB connections for sync   1,000       300          ~60 (batched)
HTTP round-trips for sync 20,000/s    6,000/s      0 (queue or direct)
Queries per sync          3           3            1 (consolidated)
Connection headroom       0.1x        0.3x         1.7x
```

---

## Phase 6: Checkpoint & Agent Workflow Optimization (Medium Risk, High Impact)

Agent workflows at scale (batch-updating hundreds of documents on 2,000-document branches) create extreme database load through the checkpoint system. This phase makes checkpoints viable at target scale.

### 6.1 Incremental Checkpoints

**Problem:** Every checkpoint snapshots **all** documents on a branch. For a 2,000-document branch, `createCheckpoint()` runs a `DISTINCT ON` query across all document_versions rows for the branch, then inserts 2,000 rows into `checkpoint_documents`. An agent editing 5 documents triggers a full 2,000-document snapshot.

**Change:**
- Introduce incremental checkpoints that only capture documents changed since the previous checkpoint
- Add a `parent_checkpoint_id` column to the `checkpoints` table
- When resolving a checkpoint, walk the chain: current checkpoint's documents + parent's documents (for unchanged docs)
- Full checkpoints are still created periodically (e.g., on branch merge) for chain compaction

**Implementation:**
```sql
-- Current: snapshots ALL documents every time
SELECT DISTINCT ON (dv.document_id)
  dv.document_id, dv.id as document_version_id
FROM app.document_versions dv
WHERE dv.branch_id = $1
ORDER BY dv.document_id, dv.version_number DESC

-- Improved: only documents changed since last checkpoint
SELECT DISTINCT ON (dv.document_id)
  dv.document_id, dv.id as document_version_id
FROM app.document_versions dv
WHERE dv.branch_id = $1
  AND dv.created_at > $2  -- last checkpoint timestamp
ORDER BY dv.document_id, dv.version_number DESC
```

**Impact on agent workflows:**

| Scenario | Current Rows Inserted | Incremental Rows Inserted |
|----------|----------------------|--------------------------|
| Agent edits 5 of 2,000 docs (pre-edit checkpoint) | 2,000 | 0 (no changes yet) |
| Agent edits 5 of 2,000 docs (post-edit checkpoint) | 2,000 | 5 |
| Agent batch-edits 200 of 2,000 docs | 4,000 (2 checkpoints) | 200 |

**Files Modified:**
- `workers/src/db/migrations/019_incremental_checkpoints.sql` — add `parent_checkpoint_id` column
- `workers/src/services/checkpoint-service.ts` — incremental checkpoint logic
- `workers/src/services/checkpoint-service.ts` — checkpoint resolution (walk chain)

**Risk:** Medium. Adds complexity to checkpoint resolution. Must ensure `revertToCheckpoint()` and `getDocumentsAtCheckpoint()` correctly walk the chain.

**Tests:**
- Verify incremental checkpoint captures only changed documents
- Verify checkpoint chain resolution returns complete document set
- Verify revert to incremental checkpoint restores all documents (including unchanged)
- Verify full checkpoint compaction works correctly

**As shipped (PCC-3730), differing from the plan above:**

The `created_at > $2` boundary sketched in the implementation snippet was not
what shipped, because a timestamp boundary races the parent checkpoint's own
transaction — `now()` is transaction start, so a version written while the
parent commits falls on the wrong side of the comparison and is captured twice
or not at all. The delta is defined by **version identity** instead: capture the
branch's latest version per document, keep it when its id differs from what the
parent chain already records. No boundary, no window.

That also makes deletions representable, which the timestamp form structurally
could not. An incremental manifest keeps tombstones (a full snapshot does not
need them — there, absence is the deletion), `resolveCheckpointDocuments`
filters them out of the live set, and `resolveCheckpointDeletions` returns them
so revert can re-apply a deletion the checkpoint recorded.

Two consequences worth knowing:

- `app.checkpoints.is_full_snapshot` (migration 063) records what a capture
  actually did, so a chain walk stops at the nearest full snapshot instead of
  running to the branch root. Walking past one resurrects documents that
  snapshot omitted.
- Merge checkpoints null their parent by design, so they terminate a walk
  without describing the whole branch. Resolution stays complete anyway — the
  identity-based delta re-captures what the chain does not record — at the cost
  of the first session manifest after a merge being branch-sized rather than
  edit-sized.

Session pre-edit checkpoints capture incrementally as of PCC-3730; the
`forceFullSnapshot` escape hatch remains for callers that need a full sweep
(template pre-migration uses it).

### 6.2 Batch Revert Operations

**Problem:** `revertToCheckpoint()` runs a `for` loop executing one INSERT per document (`checkpoint-service.ts:671-692`). For a 2,000-document branch, this is 2,000 sequential INSERT statements inside a transaction, taking ~10 seconds.

**Change:**
Replace the per-document INSERT loop with a single bulk INSERT...SELECT:

```sql
-- Current: 2,000 individual INSERTs in a loop
FOR doc IN documentsAtCheckpoint:
  INSERT INTO app.document_versions (...) SELECT ... WHERE document_id = doc.id

-- Improved: single bulk INSERT
INSERT INTO app.document_versions (
  document_id, branch_id, version_number, snapshot, crdt_state,
  source, created_by_id, created_by_type
)
SELECT
  cd.document_id,
  $1,  -- branch_id
  sub.next_version,
  dv.snapshot,
  dv.crdt_state,
  'revert',
  $2,  -- created_by_id
  $3   -- created_by_type
FROM app.checkpoint_documents cd
JOIN app.document_versions dv ON cd.document_version_id = dv.id
JOIN LATERAL (
  SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
  FROM app.document_versions
  WHERE document_id = cd.document_id AND branch_id = $1
) sub ON true
WHERE cd.checkpoint_id = $4
```

**Impact:**

| Scenario | Current | Batch |
|----------|---------|-------|
| Revert 2,000 docs | 2,000 INSERTs, ~10s | 1 INSERT...SELECT, ~200ms |
| Connection hold time | 10+ seconds | <500ms |
| Transaction risk | High (long lock) | Low (short lock) |

**Files Modified:**
- `workers/src/services/checkpoint-service.ts` — replace loop with bulk query

**Risk:** Low. Standard SQL optimization. The `JOIN LATERAL` pattern for per-row subqueries is well-supported in PostgreSQL.

**Tests:**
- Verify bulk revert produces correct version numbers
- Verify all documents are reverted (not just subset)
- Verify structure and metadata restoration still works
- Performance test: revert 2,000 documents completes in <1s

### 6.3 Checkpoint Operation Bypass for Queue

**Problem:** Agent checkpoint operations (`agent-edit-start`, `agent-edit-complete`) currently go through the same HTTP internal API path as syncs. With incremental checkpoints (Phase 6.1), these operations become lightweight enough for direct execution but should not compete with sync traffic for connections.

**Change:**
- Agent checkpoint operations use direct Hyperdrive from the DO (Phase 5.3) instead of the HTTP round-trip
- Checkpoint creation is lightweight with incremental mode (5 rows instead of 2,000)
- Sync operations continue through the Queue (Phase 5.1)

**Files Modified:**
- `workers/src/durable-objects/document-session.ts` — checkpoint methods use direct DB

**Risk:** Low once Phase 5.3 (direct Hyperdrive) is validated.

### Phase 6 Impact

```
                             Current     + Phase 6
                             -------     ---------
Checkpoint (2K docs, 5 changed)
  Rows inserted              2,000       5
  Query time                 ~2s         ~10ms
  Connection hold            ~5s         ~100ms

Revert (2K docs)
  INSERT statements          2,000       1
  Total time                 ~10s        ~200ms
  Connection hold            ~10s        ~300ms

Agent edit cycle (start + edit + complete)
  Total DB time              ~15s        ~300ms
  Connections blocked         1 for 15s   1 for 300ms
```

---

## Phase 7: PostgreSQL Horizontal Scaling (High Effort, Future)

For millions of sites, a single PostgreSQL instance will eventually hit capacity even with all the above optimizations. This phase outlines the path to horizontal scaling.

### 7.1 Site-Based Sharding

**Observation:** The data model naturally shards by site. All tables have `site_id` directly or via foreign key chain (branch → site, document → site). Cross-site queries are never needed — branches, merges, checkpoints, and authorization are all site-scoped.

**Change:**
- Hash `site_id` to route to one of N PostgreSQL clusters
- Each cluster gets its own Hyperdrive configuration
- The Worker routing layer determines the correct Hyperdrive binding based on site_id
- Shard mapping stored in KV or a lightweight lookup table

**Scaling math:**
```
With 10 shards:
  60 connections/shard (from Phase 5 queue batching)
  = 600 total connections
  Each shard handles ~100K sites
  Independent scaling per shard
```

**This is primarily an infrastructure/deployment change**, not a code change. The application code already scopes all queries by site.

**Prerequisites:** Phases 5 and 6 must be complete first, as sharding without connection optimization would just distribute the same problem across more databases.

> **Decision needed:** Sharding strategy — consistent hashing vs. range-based vs. lookup table? What is the expected timeline for needing this (dependent on customer growth)?

---

## Implementation Order & Dependencies

```
Phase 1 (no dependencies, start immediately)           ← DO-internal, low risk
├── 1.1 Debounce persistence
├── 1.2 Debounce broadcasts
└── 1.3 Delta encoding for connections

Phase 2 (independent of Phase 1)                        ← infrastructure
└── 2.1 SQLite migration

Phase 3 (can start after Phase 1)                       ← presence architecture
├── 3.1 Persist presence state
├── 3.2 Dedicated Presence DO ← depends on 3.1
└── 3.3 Retire fan-out rollup ← depends on 3.2

Phase 4 (independent, can run in parallel)              ← defensive measures
├── 4.1 WebSocket rate limiting
└── 4.2 Lazy CRDT initialization

Phase 5 (start after Phase 1)                           ← connection architecture
├── 5.1 Queue-based sync ← highest single impact
├── 5.2 Consolidate sync queries
└── 5.3 Direct Hyperdrive from DOs

Phase 6 (start after Phase 5)                           ← agent workflows
├── 6.1 Incremental checkpoints
├── 6.2 Batch revert operations
└── 6.3 Checkpoint bypass for queue ← depends on 5.3, 6.1

Phase 7 (future, when needed)                           ← horizontal scaling
└── 7.1 Site-based sharding ← depends on 5, 6
```

**Recommended priority order** (by impact per effort):

1. **Phase 5.1** — Queue-based sync (solves the connection limit, biggest single improvement)
2. **Phase 1.1-1.2** — Debounce persistence + broadcasts (reduces load 3-5x, low effort)
3. **Phase 6.1-6.2** — Incremental checkpoints + batch revert (makes agent workflows viable)
4. **Phase 2.1** — SQLite migration (removes 128 KiB storage limit)
5. **Phase 5.2-5.3** — Query consolidation + direct Hyperdrive (reduces latency, improves efficiency)
6. **Phase 3.1-3.3** — Presence architecture (eliminates fan-out queries)
7. **Phase 4.1-4.2** — Rate limiting + lazy init (defensive hardening)
8. **Phase 7.1** — Sharding (when site count exceeds single-instance capacity)

---

## Decisions Made

*Resolved 2026-03-01*

1. **SQLite Migration (Phase 2.1):** Only local environment exists. Use Option A — delete existing DO classes and recreate with `new_sqlite_classes`. DOs will re-hydrate from PostgreSQL on next connection. No pre-migration sync needed.

2. **PresenceManager Communication (Phase 3.2):** Use **RPC methods**. Current `compatibility_date` is `2024-12-01` (well past the `2024-04-03` requirement). RPC provides type safety, less boilerplate, and is Cloudflare's recommended approach.

3. **Broadcast Debounce Window (Phase 1.2):** **50ms, hardcoded constant.** Well-established value in collaborative editing. No environment variable — change the constant if tuning is needed later.

4. **Persistence Debounce Window (Phase 1.1):** **2000ms, hardcoded constant.** The theoretical data-at-risk window is covered by client-side CRDT state (connected clients re-sync on reconnect). Always persist immediately on last client disconnect.

5. **Sync Latency (Phase 5.1):** **Queue-based sync for regular edits (10-30s latency accepted). Checkpoint operations bypass the queue and use direct Hyperdrive for transactional guarantees.** Rationale: the DO and its local storage are authoritative during editing; PostgreSQL is the durability/merge/history layer. The 10-30s window only affects cross-DO PostgreSQL queries, not realtime editing. Checkpoints need consistency guarantees that the queue can't provide.

6. **Hyperdrive in DOs (Phase 5.3):** Converted from a decision to a **technical validation step**. Confirm Hyperdrive bindings work from DO context during Phase 5.3 implementation before building dependent features.

7. **Sharding Timeline (Phase 7.1):** Keep as a **future phase with no specific timeline**. At projected growth (50K sites in year 1), connection math shows ~10 concurrent Hyperdrive connections — well within limits. Application code is already site-scoped, so migration is primarily infrastructure when needed.

---

## Estimated Scope

| Phase | Items | New Files | Modified Files | Test Files |
|-------|-------|-----------|----------------|------------|
| 1     | 3     | 0         | 2              | 3          |
| 2     | 1     | 0         | 2              | 2          |
| 3     | 3     | 1         | 4              | 4          |
| 4     | 2     | 0         | 2              | 2          |
| 5     | 3     | 1         | 4              | 5          |
| 6     | 3     | 1         | 2              | 4          |
| 7     | 1     | 1         | 2              | 2          |
| **Total** | **16** | **4** | **~12 unique** | **~22** |

---

## Projected Scale After All Improvements

```
                        Current    + Phase 1    + Ph 5 (Queue)  + Ph 6 (Ckpt)  + Ph 7 (Shard)
                        -------    ---------    -------------   ------------   -------------
Sync requests/s         20,000     6,000        6,000 (queued)  6,000          6,000
DB connections (sync)    1,000     300          ~60 (batched)   ~60            ~6/shard
Hyperdrive headroom      0.1x     0.3x         1.7x            1.7x           17x/shard
Checkpoint (2K docs)     ~5s      ~5s          ~5s             ~10ms          ~10ms
Revert (2K docs)         ~10s     ~10s         ~10s            ~200ms         ~200ms
Agent edit cycle          ~15s     ~15s         ~15s            ~300ms         ~300ms
```

## Success Criteria

| Goal | Metric | Target |
|------|--------|--------|
| Connection scaling | Concurrent Hyperdrive connections | < 100 per config under steady-state load |
| Sync throughput | Document syncs/second sustained | 10,000+ (via queue batching) |
| Editor concurrency | Editors per document without DO overload | 50 without errors |
| Presence latency | Site-level presence query | < 100ms regardless of document count |
| DO efficiency | DO storage writes under active editing | < 1/s per DO (debounced) |
| Broadcast efficiency | WebSocket sends per incoming edit | O(N) per batch window, not O(N^2) |
| Document size | Max persistable CRDT state | > 2 MB (SQLite backend) |
| Checkpoint speed | Checkpoint for 2,000-doc branch (5 changed) | < 100ms |
| Revert speed | Revert 2,000 documents | < 500ms |
| Agent workflow | Full agent edit cycle (start + edit + complete) | < 1s total DB time |
| No regressions | Existing test suites | All passing |
