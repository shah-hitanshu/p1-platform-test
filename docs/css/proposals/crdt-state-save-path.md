# Proposal: Unify Save Path to Preserve CRDT State

> **Status: VALIDATED** — Option A implemented and verified on 2026-02-08.
> See [Validation Results](#validation-results) below.

## Problem

When a user edits a document in the Puck editor, **two separate save paths fire in parallel**, creating duplicate versions — one without CRDT state and one with:

| Path | Trigger | Delay | CRDT State | Source |
|------|---------|-------|------------|--------|
| REST API | `performSave()` via debounce | 3000ms | **No** | `edit` |
| WebSocket DO sync | `scheduleSync()` via idle timeout | 5000ms | **Yes** | `realtime` |

The REST path always wins the race by ~2 seconds. The DO sync then creates a second version with CRDT state, but this causes:

1. **Duplicate versions** — every edit creates 2 versions (one REST, one DO sync)
2. **CRDT merge failures** — the merge system uses `latestVersionId` from conflict detection, which may point to the REST-created version (no CRDT state), causing `MissingCrdtStateError`
3. **Version inflation** — the `rs6-new` document already has 131 versions, many of which are duplicates

### Code References

- `CSSPuckProvider.tsx:345-349` — REST save: `userClient.versions.create()` with snapshot only
- `CSSPuckProvider.tsx:423` — WebSocket send: `realtime.applyLocalChange(data)` (same edit, parallel path)
- `document-session.ts:1547` — DO sync delay: `SYNC_IDLE_TIMEOUT_MS = 5000`
- `document-session.ts:1784` — DO sync includes CRDT: `Y.encodeStateAsUpdate(this.ydoc)`
- `crdt-merge-service.ts:245-246` — Merge fails when `crdtState` is undefined

---

## Options

### Option A: Remove REST save, rely solely on DO sync (Recommended)

**Change:** Remove the `performSave()` REST API call from `CSSPuckProvider`. The WebSocket path (`realtime.applyLocalChange`) already sends edits to the DocumentSession DO, which syncs to PostgreSQL via `/internal/crdt-sync` with full CRDT state.

**Files changed:**
- `packages/puck-css/src/CSSPuckProvider.tsx` — Remove `performSave()`, `debouncedSave`, and REST save logic. Keep `applyLocalChange` as the only save path. Add a fallback: if WebSocket is disconnected, queue edits and replay when reconnected (or fall back to REST as a degraded mode).

**Pros:**
- Single save path — no duplicate versions
- Every version has CRDT state
- Simpler code (remove ~40 lines of REST save logic)
- DO already handles persistence, sync, and conflict detection

**Cons:**
- Requires WebSocket connection for saves (need offline/fallback story)
- DO sync has 5-second idle delay — user may navigate away before sync fires
- If `INTERNAL_API_URL` is not configured, no versions are saved at all

**Risk mitigation:**
- Reduce `SYNC_IDLE_TIMEOUT_MS` from 5000ms to 2000ms for faster persistence
- Add `beforeunload` handler to trigger immediate sync before page close
- Keep REST save as degraded fallback when WebSocket is not connected

---

### Option B: Remove DO sync, add CRDT state to REST save

**Change:** Generate CRDT state client-side and include it in the REST API save. Remove or disable the DO's `syncToPostgres` when the client is handling persistence.

**Files changed:**
- `packages/puck-css/src/CSSPuckProvider.tsx` — After `applyLocalChange`, extract CRDT state from the Yjs doc via `realtime.getCrdtState()` and include it in the REST API call
- `packages/puck-css/src/hooks/useRealtime.ts` — Add `getCrdtState()` method that returns `Y.encodeStateAsUpdate(ydoc)` as base64
- `workers/src/routes/document-api.ts` — Accept optional `crdtState` in `CreateVersionBody`
- `workers/src/durable-objects/document-session.ts` — Skip `scheduleSync` when client indicates it's handling persistence

**Pros:**
- REST save is immediate (3-second debounce vs 5-second idle)
- Works without internal API configuration
- Single version per edit

**Cons:**
- Client sends full CRDT state on every save (can be large — base64 Yjs updates grow over time)
- Requires coordinating between DO sync and client sync to avoid conflicts
- Two systems maintaining CRDT state (client Yjs doc + DO Yjs doc) — divergence risk

---

### Option C: Keep both paths, deduplicate on the backend

**Change:** Add deduplication logic so the second save (DO sync) updates the existing version's CRDT state rather than creating a new version.

**Files changed:**
- `workers/src/services/crdt-sync-service.ts` — Before creating a new version, check if a recent version exists with the same snapshot hash. If so, update its `crdt_state` column instead of creating a new version.
- `workers/src/services/document-version-service.ts` — Add `updateVersionCrdtState()` function

**Pros:**
- Minimal frontend changes
- Both paths continue working independently
- Graceful degradation if either path fails

**Cons:**
- Complexity: hash-based deduplication is fragile (snapshot equality doesn't guarantee same edit)
- Still creates duplicate versions in race conditions
- Doesn't address the root cause (two save paths)

---

## Recommendation

**Option A** is the cleanest solution. The WebSocket/DO path was designed to be the canonical save path for collaborative editing. The REST save was a pre-realtime implementation that was never removed when WebSocket support was added.

The key risk (WebSocket disconnection) is mitigated by:
1. Keeping REST as a **fallback-only** path when `realtime.connected` is false
2. Reducing the DO sync timeout for faster persistence
3. Adding `beforeunload` flush

This also fixes the duplicate version problem and ensures every version has CRDT state available for merge operations.

---

## Scope

This is a **cross-repo change** affecting:
- `puck-css-integration` — CSSPuckProvider save logic
- `collaborative-state-system` — Potentially reduce sync timeout, add CRDT state to REST API as fallback

Estimated test impact: Update existing CSSPuckProvider save tests, add new tests for fallback behavior.

---

## Validation Results

**Date:** 2026-02-08
**Result:** Option A is implemented and working. No further code changes needed.

### Implementation

The fix was applied in `CSSPuckProvider.tsx:347-356`. When realtime is connected, `performSave()` skips the REST API call entirely:

```typescript
if (enableRealtime && realtimeConnectedRef.current) {
  pendingDataRef.current = null;
  setSaveStatus('saved');
  setLastSaved(new Date());
  return;
}
```

The REST save is retained as a fallback when realtime is disconnected (`enableRealtime` is false or `realtimeConnectedRef.current` is false).

### Test procedure

1. Loaded the "test" document in the Puck editor with realtime enabled
2. Confirmed WebSocket connected via console log: `[Realtime] WebSocket connected`
3. Edited the title field to a unique marker value (`SYNC-TEST-1738901000`)
4. Waited for DO sync idle timeout (5 seconds) to flush to PostgreSQL
5. Queried the database for new versions

### Results

| Metric | Before fix | After fix |
|--------|-----------|-----------|
| Versions per edit | 2 (REST + DO sync) | **1** (DO sync only) |
| Latest version source | `edit` (no CRDT) | **`realtime`** (with CRDT) |
| `has_crdt` on latest | false | **true** |
| CRDT merge compatibility | Fails (`MissingCrdtStateError`) | **Works** |

Database confirmation:
```
version_number | source   | has_crdt | title
574            | realtime | t        | SYNC-TEST-1738901000
573            | merge    | t        | MAIN-CRDT-1770516663629
```

### `INTERNAL_API_URL` configuration

The `INTERNAL_API_URL` concern from Option A ("If not configured, no versions are saved at all") is addressed — it is configured at every deployment level in `wrangler.jsonc`:

- **Local dev:** `http://localhost:8787`
- **Sandbox:** `https://collaborative-state-worker-sbx1.pantheon.workers.dev`
- **Production:** `https://collaborative-state-worker-prod.pantheon.workers.dev`

### Remaining risk mitigations (not yet implemented)

- Reduce `SYNC_IDLE_TIMEOUT_MS` from 5000ms to 2000ms for faster persistence
- Add `beforeunload` handler to trigger immediate sync before page close
