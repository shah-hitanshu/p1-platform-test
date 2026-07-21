# Client-Side Optimizations for Wave 2 Backend Changes

**Date:** 2026-03-02
**Status:** Planned
**Context:** The collaborative-state-system backend completed Wave 2 scaling optimizations (PR #23 on `feat/scaling-optimizations`). Several backend changes require or enable corresponding client-side updates in the puck-css-integration packages.

---

## Summary

| # | Optimization | Priority | Package | Risk |
|---|-------------|----------|---------|------|
| 1 | Delta encoding on WebSocket connect | High | css-client | Low |
| 2 | Client-side message rate awareness | Medium | css-client | Low |
| 3 | Increase presence polling intervals | Medium | puck-css | Low |
| 4 | Remove debug console.log statements | Medium | css-client, puck-css | None |

---

## 1. Delta Encoding on WebSocket Connect (Phase 1.3)

**Backend reference:** SCALING-PLAN.md Phase 1.3 — Delta Encoding for New Connections

**Problem:** On every WebSocket connect/reconnect, the server sends the full CRDT history via `Y.encodeStateAsUpdate(this.ydoc)`. For large documents with extensive edit history, this produces multi-megabyte payloads. The server already supports delta encoding — if the client sends its Yjs state vector as a query parameter, the server responds with only the diff.

**Server-side support (already implemented):**
- `document-session.ts:1416-1427` — parses `stateVector` query parameter (base64-encoded)
- Uses `Y.encodeStateAsUpdate(this.ydoc, clientStateVector)` when present
- Falls back to full state when absent

**Client-side change needed:**

**File:** `packages/css-client/src/realtime.ts`

**Current behavior (line 208-255):**
```typescript
connect(params: ConnectionParams): void {
  // Builds WebSocket URL without state vector
  const url = new URL(`${wsBase}/api/sites/${params.siteId}/...`);
  url.searchParams.set('actorId', params.actorId);
  // ... other params
  // No stateVector parameter sent
}
```

**Required change:**
- On initial connect: no state vector needed (client has no prior state)
- On reconnect (`hasConnectedOnce === true`): encode and send the client's current state vector
- Encode via `Y.encodeStateVector(this.ydoc)` → base64 → `stateVector` query parameter

```typescript
// In connect() or the PartySocket URL builder:
if (this.hasConnectedOnce) {
  const sv = Y.encodeStateVector(this.ydoc);
  const svBase64 = btoa(String.fromCharCode(...sv));
  url.searchParams.set('stateVector', svBase64);
}
```

**Current reconnect behavior (line 270-277):**
```typescript
// On reconnect, sends full local state as an update
if (this.hasConnectedOnce && this.ws) {
  const localState = Y.encodeStateAsUpdate(this.ydoc);
  this.ws.send(localState);
}
```

This reconnect path already sends local changes to the server, which is correct. The state vector optimization reduces what the **server sends back** to the client on reconnect — the two changes work together:
1. Client sends state vector → server responds with delta (not full state)
2. Client sends full local state → server merges any changes made while disconnected

**Impact:**
- Reconnect payload: full document history → only changes since disconnect
- Significant for large documents (2,000+ components) and tab-backgrounding scenarios
- No behavioral change — Yjs merge semantics are identical

**Tests:**
- Verify reconnect sends state vector query parameter
- Verify initial connect does NOT send state vector
- Verify document state is correct after reconnect with delta

---

## 2. Client-Side Message Rate Awareness

**Backend reference:** SCALING-PLAN.md Phase 4.1 — WebSocket Message Rate Limiting

**Problem:** The backend now enforces a 50 messages/second rate limit per actor. After 3 consecutive rate-limited windows, the server closes the connection with code 1008. The client has no awareness of this limit and sends every Yjs update immediately.

**Current behavior:**

`packages/css-client/src/realtime.ts:194-198` — Y.Doc `update` listener:
```typescript
this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin !== 'remote' && this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.send(update);  // Immediate send on every local change
  }
});
```

`packages/css-client/src/realtime.ts:444-447` — `applyLocalUpdate()`:
```typescript
applyLocalUpdate(update: Uint8Array): void {
  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.send(update);  // Immediate send
  }
}
```

**Risk assessment:** Normal Puck editing (typing, dragging, resizing) typically generates 5-15 updates/second — well under the 50/sec limit. However, programmatic batch operations (e.g., bulk field updates, paste operations, agent edits applying many changes rapidly) could approach or exceed the limit.

**Recommended change:**
- Add a lightweight outbound message counter with sliding window
- When approaching the limit (e.g., >40 msgs in the current 1s window), buffer updates using `Y.mergeUpdates()` and flush at the next safe interval
- Log a warning when rate limiting kicks in for debugging
- Handle server-sent `RATE_LIMITED` error messages gracefully (already a text JSON message the client can parse)

**Files:**
- `packages/css-client/src/realtime.ts` — add rate-aware send wrapper, handle `RATE_LIMITED` presence error

**Tests:**
- Verify normal editing sends updates immediately (no unnecessary buffering)
- Verify rapid updates (>40/sec) trigger client-side coalescing
- Verify `RATE_LIMITED` server error is handled without disconnecting
- Verify recovery after rate limit window passes

---

## 3. Increase Presence Polling Intervals

**Backend reference:** SCALING-PLAN.md Phase 3.2 — PresenceManager DO

**Problem:** All three presence hooks poll every 5 seconds (5000ms). The backend's new PresenceManager DO replaced N-document fan-out queries with a single RPC to an aggregated index, making presence queries much cheaper. The client can safely poll less frequently.

**Current defaults:**

| Hook | File | Line | Default |
|------|------|------|---------|
| `usePresence` | `packages/puck-css/src/hooks/usePresence.ts` | 68 | `5000` |
| `useBranchPresence` | `packages/puck-css/src/hooks/useBranchPresence.ts` | 62 | `5000` |
| `useSitePresence` | `packages/puck-css/src/hooks/useSitePresence.ts` | 62 | `5000` |

**Recommended change:**
- Increase default polling interval to `10000` (10 seconds) for all three hooks
- WebSocket-based presence updates (real-time, sub-second) remain the primary channel when connected
- REST polling is the fallback for when WebSocket presence is unavailable
- Users can still override via the `pollingInterval` prop

**Impact:**
- 50% reduction in presence REST API calls
- Minimal UX impact — collaborator avatars update via WebSocket in real-time; REST polling only fills gaps
- Consistent with PresenceManager's 120-second stale threshold (polling at 10s is still 12x faster than expiry)

**Tests:**
- Verify default polling interval is 10000ms
- Verify `pollingInterval` prop override still works
- Verify presence updates via WebSocket are unaffected

---

## 4. Remove Debug Console.log Statements

**Problem:** Development debug logging was left in production code. These statements log to the browser console on every WebSocket message, reconnect, and focus region update, creating noise for consumers of the packages.

**Files and locations:**

### `packages/css-client/src/realtime.ts`

| Line | Statement | Disposition |
|------|-----------|-------------|
| 266 | `console.log('[Realtime] WebSocket connected')` | Remove (has TODO marker) |
| 275 | `console.log('[Realtime] Reconnect detected, sending local state, size:', ...)` | Remove |
| 297 | `console.log('[Realtime] Received message, update size:', ...)` | Remove (has TODO marker) |
| 305 | `console.log('[Realtime] Applied update, snapshot:', ...)` | Remove |
| 399 | `console.log('[Realtime] Page became visible, forcing reconnection...')` | Remove |
| 487 | `console.log('[Realtime] sendFocusRegions called:', ...)` | Remove |
| 489 | `console.log('[Realtime] Cannot send focus regions - WebSocket not ready')` | Remove |
| 499 | `console.log('[Realtime] Sending focus_region_update:', ...)` | Remove |
| 541 | `console.log('[Realtime] Focus region ack...')` | Remove |
| 549 | `console.warn('[Realtime] Unknown message type...')` | Keep (genuine warning) |

### `packages/puck-css/src/hooks/useFocusRegionReporting.ts`

| Line | Statement | Disposition |
|------|-----------|-------------|
| 123 | `console.log('[FocusRegion] Trying WebSocket...')` | Remove |
| 125 | `console.log('[FocusRegion] Sent via WebSocket successfully')` | Remove |
| 129 | `console.log('[FocusRegion] WebSocket send failed...')` | Remove |
| 158 | `console.log('[FocusRegion] setFocusRegions called...')` | Remove |
| 163 | `console.log('[FocusRegion] Skipping - not enabled')` | Remove |

**Total:** 14 debug statements to remove, 1 warning to keep.

**Tests:**
- No test changes needed — these are log-only statements with no behavioral impact

---

## Implementation Order

1. **Item 4** (console.log cleanup) — zero risk, immediate improvement
2. **Item 3** (presence polling) — single-line default change per hook
3. **Item 1** (delta encoding) — most impactful optimization, requires careful testing
4. **Item 2** (rate awareness) — defensive measure, lowest priority until edge cases surface

---

## Relationship to SCALING-PLAN.md

| SCALING-PLAN Phase | Server Status | Client Item |
|-------------------|---------------|-------------|
| 1.3 Delta Encoding | Implemented (stateVector query param) | Item 1 — client must send state vector |
| 3.2 PresenceManager DO | Implemented (single RPC query) | Item 3 — reduce polling frequency |
| 4.1 Rate Limiting | Implemented (50 msg/sec, close after 3) | Item 2 — client-side awareness |
| All phases | Debug logging appropriate for dev | Item 4 — clean up for production |
