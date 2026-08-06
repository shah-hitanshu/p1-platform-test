/**
 * reloadFromPostgres disconnects WebSocket clients
 *
 * After a reload from PostgreSQL (e.g. migration), the DO disconnects all
 * WebSocket clients with code 4001 so they reconnect with fresh state.
 * Broadcasting a diff doesn't work reliably because the client's Puck data
 * state is stale — its onChange fires with old data before the diff is
 * applied, sending the stale state back and overwriting the migration.
 *
 * This test verifies:
 * - WebSocket clients are closed with code 4001 after reload
 * - The sync schedule is cancelled (storage.delete called)
 * - pendingPuckActions are cleared
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { reloadFromPostgres } from '../../src/durable-objects/crdt-endpoint-handlers';
import type { CrdtEndpointDeps } from '../../src/durable-objects/crdt-endpoint-handlers';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a minimal CrdtEndpointDeps stub for reloadFromPostgres.
 *
 * The caller can override individual properties as needed.
 */
function createMockDeps(overrides: Partial<CrdtEndpointDeps> = {}): CrdtEndpointDeps {
  let ydoc = new Y.Doc();

  const deps: CrdtEndpointDeps = {
    getYdoc: () => ydoc,
    setYdoc: (doc: Y.Doc) => { ydoc = doc; },
    getInitialized: () => true,
    setInitialized: vi.fn(),
    env: {},
    storage: {
      delete: vi.fn().mockResolvedValue(true),
    } as unknown as DurableObjectStorage,
    sessionInfo: {
      siteId: 'site-1', documentId: 'doc-1', branchId: 'branch-1',
    },
    editSessions: new Map(),
    activityDetector: {} as CrdtEndpointDeps['activityDetector'],
    syncManager: {
      initializeFromPostgres: vi.fn().mockResolvedValue(undefined),
      lastSyncedStateVectorHash: null,
      computeStateVectorHash: vi.fn().mockReturnValue('hash'),
      pendingPuckActions: [],
    } as unknown as CrdtEndpointDeps['syncManager'],
    getWebSockets: vi.fn().mockReturnValue([]),
    persist: vi.fn().mockResolvedValue(undefined),
    flushPendingPersist: vi.fn().mockResolvedValue(undefined),
    broadcastUpdate: vi.fn(),
    scheduleCleanupAlarm: vi.fn().mockResolvedValue(undefined),
    getLastSeenBranchVersion: vi.fn().mockReturnValue(0),
    setLastSeenBranchVersion: vi.fn(),
    ...overrides,
  };

  return deps;
}

type InitFn = () => Promise<void>;

// =============================================================================
// Tests
// =============================================================================

describe('reloadFromPostgres disconnects clients after reload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('disconnects WebSocket clients with code 4001 after reload', async () => {
    const mockWs1 = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    const mockWs2 = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;

    const initialDoc = new Y.Doc();
    initialDoc.getMap('root').set('title', 'Old Title');

    const deps = createMockDeps({
      getWebSockets: vi.fn().mockReturnValue([mockWs1, mockWs2]),
    });
    deps.setYdoc(initialDoc);

    const initMock: InitFn = async () => {
      await Promise.resolve();
      deps.getYdoc().getMap('root').set('title', 'New Title');
    };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps, true);


    expect(mockWs1.close).toHaveBeenCalledWith(4001, 'Document state reloaded — please reconnect');

    expect(mockWs2.close).toHaveBeenCalledWith(4001, 'Document state reloaded — please reconnect');
  });

  it('cancels pending sync schedule after reload', async () => {
    const deps = createMockDeps();

    const initMock: InitFn = async () => { await Promise.resolve(); };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps);

    expect(deps.storage.delete).toHaveBeenCalledWith('syncSchedule');
  });

  it('clears pendingPuckActions after reload', async () => {
    const deps = createMockDeps();
    deps.syncManager.pendingPuckActions = [{ type: 'insert', componentType: 'Hero' }];

    const initMock: InitFn = async () => { await Promise.resolve(); };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps);

    expect(deps.syncManager.pendingPuckActions).toEqual([]);
  });

  it('does not broadcast diff — only disconnects sockets', async () => {
    const mockWs1 = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;

    const initialDoc = new Y.Doc();
    initialDoc.getMap('root').set('title', 'Before');

    const deps = createMockDeps({
      getWebSockets: vi.fn().mockReturnValue([mockWs1]),
    });
    deps.setYdoc(initialDoc);

    const initMock: InitFn = async () => {
      await Promise.resolve();
      deps.getYdoc().getMap('root').set('title', 'After');
    };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps, true);

    // broadcastUpdate should NOT be called — we disconnect instead
    expect(deps.broadcastUpdate).not.toHaveBeenCalled();
    // Socket should be closed, not sent to

    expect(mockWs1.send).not.toHaveBeenCalled();

    expect(mockWs1.close).toHaveBeenCalled();
  });
});
