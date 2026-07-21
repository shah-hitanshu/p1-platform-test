# PROPOSAL-003: Full Yjs CRDT Integration Plan

**Status:** Proposed
**Branch:** `feature/yjs-integration`
**Created:** 2026-01-25

## Overview

This plan enables real-time collaborative editing between the puck-css-integration frontend and collaborative-state-system backend by:
1. Syncing Durable Object CRDT state to PostgreSQL for durability and merging
2. Adding WebSocket/Yjs client to the frontend
3. Binding Yjs state to Puck Editor for bidirectional sync

## Current Gap

```
┌─────────────────────────────────────────────────────────────────┐
│ puck-css-integration (REST only)                                │
│   useAutoSave → HTTP POST → document_versions (no CRDT state)   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ DocumentSession DO (Yjs CRDT)                                   │
│   WebSocket → Y.Doc → DO Storage (NOT synced to PostgreSQL)     │
└─────────────────────────────────────────────────────────────────┘

Result: merge-crdt fails because document_versions.crdt_state is NULL
```

---

## Phase 1: Backend - DO to PostgreSQL Sync

### 1.1 Create CRDT Sync Service

**New file:** `workers/src/services/crdt-sync-service.ts`

```typescript
interface SyncCrdtToPostgresParams {
  siteId: string;
  documentPath: string;
  branchId: string;
  snapshot: Record<string, unknown>;
  crdtState: string; // Base64 encoded
  actorId: string;
  actorType: 'user' | 'agent';
}

// Functions:
- syncCrdtToPostgres(params): Promise<DocumentVersion>
- loadLatestCrdtState(siteId, documentPath, branchId): Promise<{snapshot, crdtState} | null>
```

**Implementation:**
- Lookup document by path using existing `getDocumentByPath()`
- Create version via `createDocumentVersion()` with snapshot + crdtState
- Source: `'realtime'` for WebSocket syncs

### 1.2 Add Internal Sync Endpoint

**New file:** `workers/src/routes/internal-api.ts`

```
POST /internal/crdt-sync
Authorization: X-Internal-Secret header
Body: { siteId, documentPath, branchId, snapshot, crdtState, actorId, actorType }
```

The DO will call this endpoint to persist state to PostgreSQL.

### 1.3 Extend DocumentSession DO with Sync Triggers

**Modified file:** `workers/src/durable-objects/document-session.ts`

Add sync triggers:
1. **Idle timeout** (5 seconds of no edits) → sync to PostgreSQL
2. **Last client disconnect** → immediate sync
3. **Explicit `/sync` endpoint** → manual trigger for checkpoints

```typescript
// New properties
private syncTimer: ReturnType<typeof setTimeout> | null = null;
private lastSyncedVector: Uint8Array | null = null;
private env: { INTERNAL_API_URL: string; INTERNAL_SECRET: string };

// New methods
private scheduleSync(): void
private async syncToPostgres(): Promise<void>
private async handleSync(request: Request): Promise<Response> // /sync endpoint
```

### 1.4 Initialize DO from PostgreSQL

**Modified file:** `workers/src/durable-objects/document-session.ts`

Update `initializeIfNeeded()`:
1. Try DO storage first (existing behavior)
2. If empty, query PostgreSQL for latest version with CRDT state
3. If snapshot exists but no CRDT state, initialize Y.Doc from snapshot JSON

### 1.5 Update wrangler.toml

Add environment bindings for internal sync:
```toml
[vars]
INTERNAL_API_URL = "https://..."
INTERNAL_SECRET = "..."
```

---

## Phase 2: Frontend - WebSocket Client

### 2.1 Create RealtimeClient Class

**New file:** `packages/css-client/src/realtime.ts`

```typescript
export class RealtimeClient {
  private ws: WebSocket | null;
  private ydoc: Y.Doc;

  constructor(config: RealtimeClientConfig)

  connect(params: ConnectionParams): void
  disconnect(): void
  applyLocalUpdate(update: Uint8Array): void
  getSnapshot(): Record<string, unknown>
  getYDoc(): Y.Doc
  isConnected(): boolean
}

interface RealtimeClientConfig {
  baseUrl: string;
  onUpdate?: (snapshot: Record<string, unknown>) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

interface ConnectionParams {
  siteId: string;
  branchId: string;
  documentPath: string;
  actorId: string;
  actorType: 'user' | 'agent';
}
```

**Features:**
- Auto-reconnect with exponential backoff
- Binary message handling (Yjs updates)
- Connection state tracking

### 2.2 Add Yjs Dependency

**Modified file:** `packages/css-client/package.json`

```json
"dependencies": {
  "yjs": "^13.6.0"
}
```

### 2.3 Export from Package

**Modified file:** `packages/css-client/src/index.ts`

```typescript
export { RealtimeClient } from './realtime.js';
export type { RealtimeClientConfig, ConnectionParams } from './realtime.js';
```

---

## Phase 3: Frontend - Puck Integration

### 3.1 Create Puck-Yjs Binding Utility

**New file:** `packages/puck-css/src/utils/puckYjsBinding.ts`

```typescript
// Convert PuckData to Yjs structure
export function puckDataToYMap(data: PuckData, root: Y.Map<unknown>): void

// Convert Yjs structure to PuckData
export function yMapToPuckData(root: Y.Map<unknown>): PuckData

// Create bidirectional binding with loop prevention
export function createPuckYjsBinding(
  ydoc: Y.Doc,
  onRemoteUpdate: (data: PuckData) => void
): {
  applyLocalChange: (data: PuckData) => void;
  destroy: () => void;
}
```

**Key implementation:** Use Yjs transaction origins to prevent sync loops:
- Local changes: `ydoc.transact(() => {...}, 'local')`
- Remote updates ignored when origin is `'local'`

### 3.2 Create useRealtime Hook

**New file:** `packages/puck-css/src/hooks/useRealtime.ts`

```typescript
interface UseRealtimeParams {
  client: CSSClient;
  siteId: string;
  branchId: string;
  documentPath: string | null;
  actorId: string;
  actorType: 'user' | 'agent';
  enabled?: boolean;
  onRemoteUpdate?: (data: PuckData) => void;
}

interface UseRealtimeReturn {
  connected: boolean;
  applyLocalChange: (data: PuckData) => void;
  error: Error | null;
}

export function useRealtime(params: UseRealtimeParams): UseRealtimeReturn
```

### 3.3 Integrate with CSSPuckProvider

**Modified file:** `packages/puck-css/src/CSSPuckProvider.tsx`

Add props and state:
```typescript
interface CSSPuckProviderProps {
  // ... existing
  enableRealtime?: boolean; // Default: false
}

// New state
const [realtimeConnected, setRealtimeConnected] = useState(false);

// Use hook when enabled
const realtime = useRealtime({
  client,
  siteId,
  branchId,
  documentPath: currentDocument?.path ?? null,
  actorId: principal.id,
  actorType: principal.type,
  enabled: enableRealtime,
  onRemoteUpdate: (data) => {
    // Use existing PuckDataSynchronizer pattern
    setSyncKey(`remote-${Date.now()}`);
    setCurrentData(data);
  },
});

// Modify Puck onChange handler
const handlePuckChange = useCallback((data: PuckData) => {
  if (enableRealtime && realtime.connected) {
    realtime.applyLocalChange(data);
  }
  // Still debounce save for REST fallback / checkpoints
  saveData(data);
}, [enableRealtime, realtime, saveData]);
```

### 3.4 Add to Context Value

**Modified file:** `packages/puck-css/src/CSSPuckContext.tsx`

```typescript
interface CSSPuckContextValue {
  // ... existing
  realtimeEnabled: boolean;
  realtimeConnected: boolean;
}
```

---

## Phase 4: Testing

### 4.1 Backend Tests

**New file:** `workers/tests/services/crdt-sync-service.spec.ts`
- Sync creates version with snapshot + crdtState
- Load returns latest CRDT state
- Handle missing document gracefully

**Modified file:** `workers/tests/durable-objects/document-session.spec.ts`
- Test sync triggers (idle, disconnect, explicit)
- Test initialization from PostgreSQL
- Test initialization from snapshot (no CRDT state)

### 4.2 Frontend Tests

**New file:** `packages/css-client/tests/realtime.spec.ts`
- WebSocket connection/disconnection
- Binary message handling
- Reconnection logic

**New file:** `packages/puck-css/tests/puckYjsBinding.spec.ts`
- PuckData ↔ Yjs conversion
- Bidirectional sync without loops
- Various component structures

### 4.3 Integration Tests

**New file:** `packages/puck-css/tests/realtimeIntegration.spec.tsx`
- Full provider with realtime enabled
- Mock WebSocket for controlled testing

---

## Phase 5: Migration for Existing Documents

Documents created before CRDT integration have `crdt_state = NULL`.

**Strategy in DocumentSession.initializeIfNeeded():**
1. If PostgreSQL has snapshot but no crdtState:
   - Create new Y.Doc
   - Populate from snapshot JSON using `puckDataToYMap()`
   - This creates initial CRDT state
2. On next sync, CRDT state is persisted
3. Future merges work with initialized state

---

## Implementation Order

**Approach:** Both repositories implemented together for end-to-end functionality.

### Step 1: Backend Foundation
- Phase 1.1: CRDT Sync Service (`collaborative-state-system`)
- Phase 1.2: Internal Sync Endpoint (`collaborative-state-system`)

### Step 2: Frontend WebSocket Client
- Phase 2.1-2.3: RealtimeClient (`puck-css-integration`)

### Step 3: Backend Integration
- Phase 1.3: Extend DocumentSession with sync triggers (`collaborative-state-system`)
- Phase 1.4: Initialize DO from PostgreSQL (`collaborative-state-system`)

### Step 4: Frontend Puck Integration
- Phase 3.1: Puck-Yjs Binding (`puck-css-integration`)
- Phase 3.2: useRealtime Hook (`puck-css-integration`)
- Phase 3.3-3.4: Provider Integration (`puck-css-integration`)

### Step 5: Testing
- Phase 4.1: Backend tests (`collaborative-state-system`)
- Phase 4.2-4.3: Frontend tests (`puck-css-integration`)
- End-to-end verification with both systems running

---

## Files to Modify/Create

### collaborative-state-system (this repo)
| File | Action |
|------|--------|
| `workers/src/services/crdt-sync-service.ts` | Create |
| `workers/src/routes/internal-api.ts` | Create |
| `workers/src/durable-objects/document-session.ts` | Modify |
| `workers/src/index.ts` | Modify (add internal routes) |
| `wrangler.toml` | Modify (add env vars) |
| `workers/tests/services/crdt-sync-service.spec.ts` | Create |
| `workers/tests/durable-objects/document-session.spec.ts` | Modify |

### puck-css-integration (separate repo)
| File | Action |
|------|--------|
| `packages/css-client/src/realtime.ts` | Create |
| `packages/css-client/src/index.ts` | Modify |
| `packages/css-client/package.json` | Modify (add yjs) |
| `packages/puck-css/src/utils/puckYjsBinding.ts` | Create |
| `packages/puck-css/src/hooks/useRealtime.ts` | Create |
| `packages/puck-css/src/CSSPuckProvider.tsx` | Modify |
| `packages/puck-css/src/CSSPuckContext.tsx` | Modify |
| `packages/puck-css/package.json` | Modify (add yjs) |
| Tests | Create/Modify |

---

## Verification

### Backend Verification
1. Start local worker: `pnpm dev`
2. Connect via WebSocket to `/api/sites/{id}/branches/{id}/documents/{path}/connect`
3. Send Yjs updates, verify they persist to PostgreSQL after 5s idle
4. Disconnect, verify immediate sync
5. Reconnect, verify state restored from PostgreSQL

### Frontend Verification
1. Enable realtime in demo app: `<CSSPuckProvider enableRealtime>`
2. Open same document in two browser tabs
3. Edit in one tab, verify changes appear in other tab
4. Create merge request between branches
5. Use `merge-crdt` strategy, verify successful merge

### Merge-CRDT Verification
1. Create document with real-time editing (has CRDT state)
2. Create branch, edit on both branches via WebSocket
3. Create merge request
4. Preview shows conflicts with both-modified
5. Select merge-crdt resolution
6. Execute merge, verify combined result

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           puck-css-integration                           │
│                                                                          │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌────────────────┐  │
│  │   Puck Editor    │───▶│   CSSPuckProvider   │◀───│ RealtimeClient │  │
│  │                  │    │                     │    │   (WebSocket)  │  │
│  │  dispatch({      │    │   - manages state   │    │                │  │
│  │    type:'setData'│◀───│   - handles sync    │    │   Y.Doc        │  │
│  │    data: ...     │    │                     │    │                │  │
│  │  })              │    │   PuckYjsBinding    │◀──▶│   (Yjs)        │  │
│  └──────────────────┘    └─────────────────────┘    └───────┬────────┘  │
│                                                              │ WS       │
└──────────────────────────────────────────────────────────────┼──────────┘
                                                               │
                                                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      collaborative-state-system                           │
│                                                                           │
│  ┌─────────────────┐         ┌──────────────────────────────────────┐    │
│  │ Real-time API   │────────▶│     DocumentSession Durable Object    │    │
│  │ /connect (WS)   │         │                                       │    │
│  │ /apply (POST)   │         │   Y.Doc ◀──▶ DO Storage (Uint8Array) │    │
│  │ /snapshot (GET) │         │      │                                │    │
│  └─────────────────┘         │      │ sync on idle/disconnect        │    │
│                              │      ▼                                │    │
│                              │   /internal/sync                      │    │
│                              └──────────────────────────────────────┘    │
│                                        │                                  │
│                                        ▼                                  │
│  ┌─────────────────┐         ┌──────────────────────────────────────┐    │
│  │ Version API     │────────▶│         CRDT Sync Service             │    │
│  │ (REST fallback) │         │                                       │    │
│  └─────────────────┘         │   snapshot (JSONB) + crdt_state (BYTEA)│   │
│                              └──────────────────────────────────────┘    │
│                                        │                                  │
│                                        ▼                                  │
│                              ┌──────────────────────────────────────┐    │
│                              │           PostgreSQL                   │    │
│                              │     document_versions table           │    │
│                              └──────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| DO-PostgreSQL sync latency | Data loss on crash | Short idle timeout (5s), immediate sync on disconnect |
| Version number gaps/conflicts | Data integrity | Use database sequence, handle concurrent inserts |
| WebSocket connection failures | Poor UX | Auto-reconnect with backoff, fallback to REST |
| Puck/Yjs data structure mismatch | Data corruption | Extensive unit tests, schema validation |
| Backward compatibility | Breaking existing apps | Feature flag `enableRealtime`, REST continues to work |
