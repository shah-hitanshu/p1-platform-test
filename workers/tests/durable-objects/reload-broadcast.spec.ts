/**
 * Regression test: reloadFromPostgres uses broadcastUpdate (not raw conn.send)
 *
 * Bug 3 from BUGFIX-PLAN.md: reloadFromPostgres() previously iterated over
 * WebSocket connections directly and called conn.send(diff), bypassing the
 * broadcastUpdate helper. This meant sender-exclusion logic was not applied
 * and the pattern diverged from the rest of the codebase.
 *
 * The fix replaces the raw loop with deps.broadcastUpdate(diff).
 * This test verifies the fix at the unit level by mocking CrdtEndpointDeps
 * and asserting that broadcastUpdate is called with the diff.
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
    env: {} as CrdtEndpointDeps['env'],
    storage: {} as DurableObjectStorage,
    sessionInfo: { siteId: 'site-1', documentId: 'doc-1', branchId: 'branch-1' } as CrdtEndpointDeps['sessionInfo'],
    editSessions: new Map(),
    activityDetector: {} as CrdtEndpointDeps['activityDetector'],
    syncManager: {
      initializeFromPostgres: vi.fn().mockResolvedValue(undefined),
      lastSyncedStateVectorHash: null,
      computeStateVectorHash: vi.fn().mockReturnValue('hash'),
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

describe('reloadFromPostgres broadcast regression', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calls deps.broadcastUpdate with the diff when content changes', async () => {
    // Seed the initial Y.Doc with some content so a diff is produced on reload
    const initialDoc = new Y.Doc();
    initialDoc.getMap('root').set('title', 'Old Title');

    const deps = createMockDeps();
    // Replace the default empty doc with our seeded one
    deps.setYdoc(initialDoc);

    // When initializeFromPostgres is called on the *new* doc, populate it
    // with different content so the diff is non-empty
    const initMock: InitFn = async () => {
      await Promise.resolve();
      const currentDoc = deps.getYdoc();
      currentDoc.getMap('root').set('title', 'New Title');
    };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps);

    // broadcastUpdate must have been called exactly once
    expect(deps.broadcastUpdate).toHaveBeenCalledTimes(1);

    // The argument must be a Uint8Array (the Yjs diff)
    const broadcastMock = deps.broadcastUpdate as ReturnType<typeof vi.fn>;
    const diffArg = broadcastMock.mock.calls[0][0] as Uint8Array;
    expect(diffArg).toBeInstanceOf(Uint8Array);
    expect(diffArg.length).toBeGreaterThan(0);
  });

  it('calls broadcastUpdate even for empty-to-empty reload (Yjs always produces a minimal diff)', async () => {
    // Both old and new docs are empty. Yjs encodeStateAsUpdate still produces
    // a minimal header (e.g. [0, 0]) with length > 0, so broadcastUpdate is called.
    // This is correct — the broadcastUpdate helper handles the no-op gracefully.
    const deps = createMockDeps();

    // initializeFromPostgres does nothing — new doc stays empty like the old one
    const initMock: InitFn = async () => { await Promise.resolve(); };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn })
      .initializeFromPostgres = initMock;

    await reloadFromPostgres(deps);

    // Yjs always produces a diff with length > 0 (at minimum a 2-byte header),
    // so broadcastUpdate is still called
    expect(deps.broadcastUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not call individual conn.send — only broadcastUpdate', async () => {
    // Create mock WebSocket connections
    const mockWs1 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    const mockWs2 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    const initialDoc = new Y.Doc();
    initialDoc.getMap('root').set('title', 'Before');

    const deps = createMockDeps({
      getWebSockets: vi.fn().mockReturnValue([mockWs1, mockWs2]),
    });
    deps.setYdoc(initialDoc);

    const initMock: InitFn = async () => {
      await Promise.resolve();
      deps.getYdoc().getMap('root').set('title', 'After');
    };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps);

    // broadcastUpdate was called (delegates to the utility that handles sender exclusion)
    expect(deps.broadcastUpdate).toHaveBeenCalledTimes(1);

    // Individual WebSocket send should NOT have been called directly by reloadFromPostgres.
    // The real broadcastUpdate implementation (in websocket-utils.ts) would call them,
    // but since we mocked broadcastUpdate, conn.send must remain untouched.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockWs1.send).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockWs2.send).not.toHaveBeenCalled();
  });

  it('broadcastUpdate receives a diff that contains the new state changes', async () => {
    const initialDoc = new Y.Doc();
    initialDoc.getMap('root').set('page', 'home');

    const deps = createMockDeps();
    deps.setYdoc(initialDoc);

    const initMock: InitFn = async () => {
      await Promise.resolve();
      const doc = deps.getYdoc();
      doc.getMap('root').set('page', 'about');
      doc.getMap('root').set('slug', '/about');
    };
    (deps.syncManager as unknown as { initializeFromPostgres: InitFn }).initializeFromPostgres = initMock;

    await reloadFromPostgres(deps);

    // Verify broadcastUpdate was called with a non-trivial Uint8Array diff
    const broadcastMock = deps.broadcastUpdate as ReturnType<typeof vi.fn>;
    const diff = broadcastMock.mock.calls[0][0] as Uint8Array;
    expect(diff).toBeInstanceOf(Uint8Array);

    // Apply the diff to an empty doc — it should contain the new state
    const verificationDoc = new Y.Doc();
    Y.applyUpdate(verificationDoc, diff);

    // The diff encoded from the new doc should carry the new values
    expect(verificationDoc.getMap('root').get('page')).toBe('about');
    expect(verificationDoc.getMap('root').get('slug')).toBe('/about');
  });
});
