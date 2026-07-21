# Plan: Split document-session.ts into Focused Modules

**Date:** 2026-03-25
**Branch:** `refactor/split-large-files`
**Goal:** Reduce `document-session.ts` from 3,225 lines to ~1,050 lines by extracting logical modules

## Context

`document-session.ts` is 2x larger than the next largest file (1,680 lines). An initial extraction already moved 5 modules out:

| Module | Lines | Status |
|--------|------:|--------|
| `document-session-types.ts` | 167 | Done (commit `0f50aaf`) |
| `crdt-operations.ts` | 353 | Done (commit `0f50aaf`) |
| `postgres-sync-manager.ts` | 522 | Done (commit `0f50aaf`) |
| `session-validators.ts` | 98 | Done (commit `0f50aaf`) |
| `agent-checkpoint-client.ts` | 234 | Done (commit `0f50aaf`) |

## Extraction Strategy

Each module exports standalone functions or small classes that receive dependencies (DO state, env, services) as parameters. No circular imports back to `DocumentSession`. The main class calls into these modules.

## Wave 1 — Low coupling, pure utilities

### 1. `session-id-parser.ts` (~140 lines)
**Source lines:** 200-340
**Contents:**
- `parseSessionId()` — parse `siteId:documentId:branchId` from DO name
- `updateSessionInfoFromRequest()` — recovery from request headers/params
- `restoreSessionInfoFromStorage()` — recovery from DO storage on alarm wakeup
- `SESSION_INFO_KEY` constant

**Dependencies:** None (pure utility functions)

### 2. `websocket-utils.ts` (~80 lines)
**Source lines:** 1653-1771, 3192-3224
**Contents:**
- `base64ToUint8Array()` — decode base64 to Uint8Array
- `persist()` — encode Y.Doc state and store in DO storage
- Debounced persistence helpers (`markPersistPending`, `flushPendingPersist`)
- Debounced broadcast helpers (`enqueueBroadcast`, `flushPendingBroadcasts`)
- `sendWsMessage()`, `broadcastToOthers()`, `sendPresenceError()` — message sending utilities
- `broadcastUpdate()` — send Uint8Array to all open WebSocket connections
- `errorResponse()`, `jsonResponse()` — HTTP response helpers

**Dependencies:** Y.Doc, DO state (for storage)

## Wave 2 — State management helpers

### 3. `edit-session-store.ts` (~40 lines)
**Source lines:** 591-631
**Contents:**
- `persistEditSessions()` — serialize all sessions to DO storage
- `restoreEditSessions()` — deserialize from storage with age filtering

**Dependencies:** DO storage, `AgentEditSession` type, `MAX_EDIT_SESSION_AGE_MS` constant

### 4. `presence-persistence.ts` (~100 lines)
**Source lines:** 633-744
**Contents:**
- `persistPresence()` — store serialized presence state
- `markPresencePersistPending()` — schedule debounced persistence
- `restorePresence()` — restore from storage after DO eviction
- `pushPresenceUpdate()` — fire-and-forget RPC to PresenceManager DO

**Dependencies:** PresenceManager service, DO storage, env (PRESENCE binding)

### 5. `org-settings-cache.ts` (~50 lines)
**Source lines:** 746-795
**Contents:**
- `loadOrgSettingsIfNeeded()` — check cached flag
- `loadOrganizationSettings()` — fetch from DB, update ActivityDetector timeout
- `refreshOrganizationSettings()` — force refresh

**Dependencies:** organization-service, ActivityDetector, SessionInfo

## Wave 3 — Larger handler groups

### 6. `agent-politeness-handlers.ts` (~520 lines)
**Source lines:** 2260-2834
**Contents:**
- `/can-agent-edit` handler
- `/agent-edit-start` handler (with pre-edit checkpoint creation)
- `/agent-edit-complete` handler (with post-edit checkpoint creation)
- `/agent-edit-abort` handler (with rollback)
- `/agent-stop` handler (human-initiated stop with rollback)
- `/edit-sessions` handler
- `/set-idle-timeout` handler
- `/org-settings` and `/org-settings/refresh` handlers
- `/kick-agent`, `/kick-all-agents`, `/active-agents` handlers

**Dependencies:** AgentEditPermissionService, edit sessions Map, agent-checkpoint-client, PresenceManager, ActivityDetector, agent-service

### 7. `websocket-presence-protocol.ts` (~390 lines)
**Source lines:** 2836-3224
**Contents:**
- `handlePresenceMessage()` — route by message type
- `tryParseJson()` — safe JSON parse
- `handleWsPublishRequest()` — async publish workflow
- `handleWsFocusRegionUpdate()` — focus region updates
- `handleWsPresenceHeartbeat()` — heartbeat handling
- `broadcastPresenceUpdate()` — presence broadcast
- `getPresenceList()` — merge presence sources

**Dependencies:** PresenceManager, ActivityDetector, PostgresSyncManager, WebSocket connections

### 8. `websocket-connection-manager.ts` (~400 lines)
**Source lines:** 1009-1404
**Contents:**
- `/connect` handler — WebSocket establishment, metadata, delta encoding
- `webSocketMessage()` — message processing with rate limiting
- `webSocketClose()` / `webSocketError()` — runtime callbacks
- `handleWebSocketDisconnect()` — cleanup on disconnect
- `compactCrdtState()` — CRDT compaction on last disconnect

**Dependencies:** Y.Doc, PresenceManager, ActivityDetector, rate limiting state, all broadcast/persist helpers

## What Remains in document-session.ts (~1,050 lines)

| Section | ~Lines | Description |
|---------|-------:|-------------|
| Class properties + constructor | 100 | Core state, service instantiation |
| `fetch()` router | 130 | Request dispatch to handlers |
| Initialization layers | 120 | `initializeMetadataIfNeeded()`, `initializeCrdtIfNeeded()` |
| CRDT endpoint handlers | 250 | `/apply`, `/snapshot`, `/sync`, `/flush`, `/initialize`, `/reload` |
| Alarm + cleanup | 280 | `alarm()`, `runCleanup()`, `scheduleCleanupAlarm()` |
| Presence/activity GET handlers | 170 | `/presences`, `/update-focus-regions`, `/activity-state` |

## Verification

After each wave:
1. `npx tsc --noEmit` — no new type errors in refactored files
2. `npx vitest run` — all 2,654+ tests pass
3. Lint clean

## Risks

- **Durable Object `this` access:** Extracted functions need DO state passed as params. Must not accidentally lose `this` binding on DO lifecycle methods (`alarm`, `webSocketMessage`, etc.).
- **Circular imports:** Modules must not import from `document-session.ts`. All shared types come from `document-session-types.ts`.
- **Rate limiting state:** WebSocket rate tracking Map is per-instance state; must stay on the class or be passed by reference.
