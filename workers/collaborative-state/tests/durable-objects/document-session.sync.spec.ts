/**
 * DO-to-PostgreSQL Sync Pipeline Tests
 *
 * Tests for the sync mechanisms between Durable Objects and PostgreSQL:
 * 1. scheduleSync — debounced alarm scheduling after edits
 * 2. alarm() — sync schedule processing and execution
 * 3. restoreSessionInfoFromStorage — recovering session IDs after hibernation
 * 4. End-to-end: edit -> alarm -> sync
 *
 * These cover the exact bugs that caused sync failures after worker restarts
 * and during Miniflare alarm wakeups.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock cloudflare:workers DurableObject base class
vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// =============================================================================
// Mock Infrastructure
// =============================================================================

interface MockDurableObjectStorage {
  get: Mock<(key: string) => Promise<unknown>>;
  put: Mock<(key: string, value: unknown) => Promise<void>>;
  delete: Mock<(key: string) => Promise<boolean>>;
  list: Mock<() => Promise<Map<string, unknown>>>;
  getAlarm: Mock<() => Promise<number | null>>;
  setAlarm: Mock<(scheduledTime: number) => Promise<void>>;
}

interface MockDurableObjectState {
  id: { toString: () => string; name: string | undefined };
  storage: MockDurableObjectStorage;
  blockConcurrencyWhile: Mock<(callback: () => Promise<void>) => Promise<void>>;
  acceptWebSocket: Mock;
  getWebSockets: Mock;
}

/**
 * Create a mock state. When `sessionId` is `undefined`, `state.id.name` is
 * undefined — simulating the Miniflare case where DOs wake from alarms
 * without a name attached.
 */
function createMockState(sessionId?: string): MockDurableObjectState {
  const storageData = new Map<string, unknown>();

  const storage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.get(key))),
    put: vi.fn().mockImplementation((key: string, value: unknown) => {
      storageData.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => Promise.resolve(storageData.delete(key))),
    list: vi.fn().mockResolvedValue(new Map()),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
  };

  const acceptedWebSockets: WebSocket[] = [];

  return {
    id: {
      toString: () => sessionId ?? 'unknown-hex-id',
      name: sessionId,
    },
    storage,
    blockConcurrencyWhile: vi.fn().mockImplementation(async (cb: () => Promise<void>) => {
      await cb();
    }),
    acceptWebSocket: vi.fn().mockImplementation((ws: WebSocket) => {
      acceptedWebSockets.push(ws);
    }),
    getWebSockets: vi.fn().mockImplementation(() => {
      return acceptedWebSockets.filter(ws => ws.readyState === WebSocket.OPEN);
    }),
  };
}

interface SyncEnv {
  API_URL: string;
  ENVIRONMENT: string;
  INTERNAL_API_URL: string;
  INTERNAL_SECRET: string;
}

function createSyncEnv(): SyncEnv {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
    INTERNAL_API_URL: 'http://localhost:8787',
    INTERNAL_SECRET: 'test-secret',
  };
}

function createEnvWithoutSecret(): { API_URL: string; ENVIRONMENT: string } {
  return {
    API_URL: 'http://localhost:8787',
    ENVIRONMENT: 'test',
  };
}

/**
 * Build a Request for `/apply` with default user actorType.
 */
function applyRequest(
  operations: { type: string; path: string; value?: unknown }[],
  actorId = 'user-1',
  sessionId?: string,
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId !== undefined) {
    headers['X-Session-Id'] = sessionId;
  }
  return new Request('http://localhost/apply', {
    method: 'POST',
    headers,
    body: JSON.stringify({ operations, actorId }),
  });
}

/**
 * Find the first fetch call matching a URL pattern.
 * Returns the call args array, or undefined.
 */
function findFetchCall(
  mockFn: Mock,
  urlPattern: string,
): unknown[] | undefined {
  return mockFn.mock.calls.find(
    (call: unknown[]) => String(call[0]).includes(urlPattern),
  ) as unknown[] | undefined;
}

/**
 * Find a storage.put call by key.
 */
function findPutCall(
  mockState: MockDurableObjectState,
  key: string,
): unknown[] | undefined {
  return mockState.storage.put.mock.calls.find(
    (call: unknown[]) => call[0] === key,
  ) as unknown[] | undefined;
}

/**
 * Find a storage.delete call by key.
 */
function findDeleteCall(
  mockState: MockDurableObjectState,
  key: string,
): unknown[] | undefined {
  return mockState.storage.delete.mock.calls.find(
    (call: unknown[]) => call[0] === key,
  ) as unknown[] | undefined;
}

/**
 * Extract the JSON body from a fetch call's RequestInit argument.
 * Asserts the call exists first to satisfy both the test and TypeScript.
 */
function extractSyncBody(syncCall: unknown[] | undefined): Record<string, unknown> {
  if (syncCall === undefined) {
    throw new Error('Expected sync call but none found');
  }
  const requestInit = syncCall[1] as RequestInit;
  return JSON.parse(requestInit.body as string) as Record<string, unknown>;
}

// =============================================================================
// Tests
// =============================================================================

describe('DO-to-PostgreSQL Sync Pipeline', () => {
  let mockFetch: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock global fetch — used by performSync and initializeFromPostgres
    mockFetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      // Default: initializeFromPostgres GET returns 404 (new document)
      if (urlStr.includes('/internal/crdt-state')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      // Default: sync POST returns 200
      if (urlStr.includes('/internal/crdt-sync')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ===========================================================================
  // 1. scheduleSync (tested via /apply endpoint)
  // ===========================================================================

  describe('scheduleSync (via /apply)', () => {
    it('should set alarm after applying an edit', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      const response = await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Hello' }]),
      );

      expect(response.status).toBe(200);
      expect(mockState.storage.setAlarm).toHaveBeenCalled();
      const alarmTime = mockState.storage.setAlarm.mock.calls[0][0];
      expect(alarmTime).toBeGreaterThan(Date.now() - 1000);
    });

    it('should replace stale alarm from previous session', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      // Stale alarm from a previous worker session — timestamp is in the past
      mockState.storage.getAlarm.mockResolvedValue(Date.now() - 60_000);

      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Updated' }]),
      );

      // Should have called setAlarm to replace the stale alarm
      expect(mockState.storage.setAlarm).toHaveBeenCalled();
    });

    it('should not replace alarm that is sooner and still valid', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');

      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      // First edit — sets alarms (cleanup at +60s, sync at +5s)
      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'First' }]),
      );

      expect(mockState.storage.setAlarm).toHaveBeenCalled();

      // Simulate an existing alarm that fires sooner than the next sync dueAt
      // scheduleSync sets dueAt = Date.now() + 5000 (SYNC_IDLE_TIMEOUT_MS)
      // An alarm at now + 2000 is sooner than dueAt and still in the future
      const soonerAlarm = Date.now() + 2000;
      mockState.storage.getAlarm.mockResolvedValue(soonerAlarm);
      mockState.storage.setAlarm.mockClear();

      // Second edit — scheduleSync checks: existingAlarm > dueAt? No (2s < 5s).
      // existingAlarm < now? No (2s in the future). So setAlarm is NOT called.
      // scheduleCleanupAlarm also skips because cleanupAlarmScheduled is true.
      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Second' }]),
      );

      expect(mockState.storage.setAlarm).not.toHaveBeenCalled();
    });

    it('should store sync schedule in DO storage', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Stored' }]),
      );

      // scheduleSync should store the schedule via storage.put
      const syncScheduleCall = findPutCall(mockState, 'syncSchedule');
      expect(syncScheduleCall).toBeDefined();
      if (syncScheduleCall === undefined) return;

      const schedule = syncScheduleCall[1] as { dueAt: number; actorId: string; actorType: string };
      expect(schedule.dueAt).toBeGreaterThan(Date.now() - 1000);
      expect(schedule.actorId).toBe('user-1');
      expect(schedule.actorType).toBe('user');
    });

    it('should skip scheduling when state vector unchanged', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      // Applying empty operations doesn't change the CRDT state
      await session.fetch(
        applyRequest([], 'user-1'),
      );

      // No sync schedule should be stored (state vector unchanged from initial)
      const syncScheduleCall = findPutCall(mockState, 'syncSchedule');
      expect(syncScheduleCall).toBeUndefined();
    });

    it('should skip scheduling when INTERNAL_SECRET not configured', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      // Env without INTERNAL_SECRET
      const session = new DocumentSession(mockState as unknown, createEnvWithoutSecret());

      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'No sync' }]),
      );

      // setAlarm should not be called for sync scheduling
      // (it may be called for cleanup, but not with a sync schedule stored)
      const syncScheduleCall = findPutCall(mockState, 'syncSchedule');
      expect(syncScheduleCall).toBeUndefined();
    });
  });

  // ===========================================================================
  // 2. alarm() handler — sync execution
  // ===========================================================================

  describe('alarm() handler — sync execution', () => {
    it('should call syncToPostgres when sync schedule is due', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const env = createSyncEnv();
      const session = new DocumentSession(mockState as unknown, env);

      // Initialize the document with some content first
      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Sync me' }]),
      );

      // Clear fetch mock calls from initialization
      mockFetch.mockClear();

      // Manually put a due sync schedule into storage
      // (the real scheduleSync already stored one, but we want to control timing)
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() - 1000, // already past due
        actorId: 'user-1',
        actorType: 'user',
      });

      // Fire the alarm
      await session.alarm();

      // fetch should have been called with the sync payload
      const syncCall = findFetchCall(mockFetch, '/internal/crdt-sync');
      expect(syncCall).toBeDefined();

      // Verify the payload
      const body = extractSyncBody(syncCall);
      expect(body.siteId).toBe('aaaaaaaa-0000-4000-8000-000000000001');
      expect(body.documentId).toBe('bbbbbbbb-0000-4000-8000-000000000001');
      expect(body.branchId).toBe('cccccccc-0000-4000-8000-000000000001');
      expect(body.actorId).toBe('user-1');
      expect(body.actorType).toBe('user');
      expect(body.snapshot).toBeDefined();
    });

    it('should not sync when schedule is not yet due', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      // Initialize
      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Not yet' }]),
      );

      mockFetch.mockClear();

      // Put a future sync schedule
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() + 60_000, // 60 seconds in the future
        actorId: 'user-1',
        actorType: 'user',
      });

      await session.alarm();

      // fetch should NOT have been called for crdt-sync
      const syncCall = findFetchCall(mockFetch, '/internal/crdt-sync');
      expect(syncCall).toBeUndefined();
    });

    it('should clear sync schedule after successful sync', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      // Initialize with content
      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Clear me' }]),
      );

      mockFetch.mockClear();
      mockState.storage.delete.mockClear();

      // Due sync schedule
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() - 1000,
        actorId: 'user-1',
        actorType: 'user',
      });

      // Ensure fetch returns 200 (success)
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      await session.alarm();

      // syncSchedule should have been deleted after successful sync
      const scheduleDelete = findDeleteCall(mockState, 'syncSchedule');
      expect(scheduleDelete).toBeDefined();
    });

    it('should not clear sync schedule on sync failure', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000001:bbbbbbbb-0000-4000-8000-000000000001:cccccccc-0000-4000-8000-000000000001');
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      // Initialize with content
      await session.fetch(
        applyRequest([{ type: 'set', path: 'data', value: 'keep schedule' }]),
      );

      mockState.storage.delete.mockClear();

      // Due sync schedule
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() - 1000,
        actorId: 'user-1',
        actorType: 'user',
      });

      // Make sync fail
      mockFetch.mockImplementation((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/internal/crdt-sync')) {
          return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      await session.alarm();

      // syncSchedule should NOT have been deleted
      const scheduleDelete = findDeleteCall(mockState, 'syncSchedule');
      expect(scheduleDelete).toBeUndefined();
    });
  });

  // ===========================================================================
  // 3. restoreSessionInfoFromStorage (tested via alarm())
  // ===========================================================================

  describe('restoreSessionInfoFromStorage (via alarm())', () => {
    it('should restore session info from storage when state.id.name unavailable', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      // No name on state.id — simulates Miniflare alarm wakeup
      const mockState = createMockState(undefined);
      const env = createSyncEnv();
      const session = new DocumentSession(mockState as unknown, env);

      // Pre-populate storage with session info (as if a previous fetch stored it)
      await mockState.storage.put('sessionInfo', {
        siteId: 'restored-site',
        documentId: 'restored-doc',
        branchId: 'restored-branch',
      });

      // Put a due sync schedule so the alarm triggers a sync
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() - 1000,
        actorId: 'user-1',
        actorType: 'user',
      });

      // Fire alarm
      await session.alarm();

      // The sync payload should use the restored session info
      const syncCall = findFetchCall(mockFetch, '/internal/crdt-sync');
      expect(syncCall).toBeDefined();

      const body = extractSyncBody(syncCall);
      expect(body.siteId).toBe('restored-site');
      expect(body.documentId).toBe('restored-doc');
      expect(body.branchId).toBe('restored-branch');
    });

    it('should not overwrite session info when already known', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      // state.id.name IS available
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000008:bbbbbbbb-0000-4000-8000-000000000008:cccccccc-0000-4000-8000-000000000008');
      const env = createSyncEnv();
      const session = new DocumentSession(mockState as unknown, env);

      // Storage has different session info — should NOT be used
      await mockState.storage.put('sessionInfo', {
        siteId: 'wrong-site',
        documentId: 'wrong-doc',
        branchId: 'wrong-branch',
      });

      // Initialize and add content
      await session.fetch(
        applyRequest([{ type: 'set', path: 'title', value: 'Known' }]),
      );

      mockFetch.mockClear();

      // Due sync schedule
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() - 1000,
        actorId: 'user-1',
        actorType: 'user',
      });

      await session.alarm();

      // The sync should use the state.id.name values, not the stored ones
      const syncCall = findFetchCall(mockFetch, '/internal/crdt-sync');
      expect(syncCall).toBeDefined();

      const body = extractSyncBody(syncCall);
      expect(body.siteId).toBe('aaaaaaaa-0000-4000-8000-000000000008');
      expect(body.documentId).toBe('bbbbbbbb-0000-4000-8000-000000000008');
      expect(body.branchId).toBe('cccccccc-0000-4000-8000-000000000008');
    });

    it('should handle missing session info in storage gracefully', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      // No name on state.id
      const mockState = createMockState(undefined);
      const session = new DocumentSession(mockState as unknown, createSyncEnv());

      // No sessionInfo in storage — the storage.get for 'sessionInfo' returns undefined

      // Put a due sync schedule
      await mockState.storage.put('syncSchedule', {
        dueAt: Date.now() - 1000,
        actorId: 'user-1',
        actorType: 'user',
      });

      // alarm() should not throw
      await expect(session.alarm()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // 4. End-to-end: edit -> alarm -> sync
  // ===========================================================================

  describe('end-to-end: edit -> alarm -> sync', () => {
    it('should sync document content to PostgreSQL after edit and alarm', async () => {
      const { DocumentSession } = await import('../../src/durable-objects/document-session');
      const mockState = createMockState('aaaaaaaa-0000-4000-8000-000000000009:bbbbbbbb-0000-4000-8000-000000000009:cccccccc-0000-4000-8000-000000000009');
      const env = createSyncEnv();
      const session = new DocumentSession(mockState as unknown, env);

      // Step 1: Apply an edit via /apply
      const editResponse = await session.fetch(
        applyRequest([
          { type: 'set', path: 'title', value: 'E2E Title' },
          { type: 'set', path: 'content', value: 'E2E Content' },
        ]),
      );
      expect(editResponse.status).toBe(200);
      const editData: { success: boolean; snapshot: Record<string, unknown> } = await editResponse.json();
      expect(editData.success).toBe(true);
      expect(editData.snapshot.title).toBe('E2E Title');

      // The /apply handler should have stored a sync schedule and set an alarm
      const syncScheduleCall = findPutCall(mockState, 'syncSchedule');
      expect(syncScheduleCall).toBeDefined();
      if (syncScheduleCall === undefined) return;

      // Clear fetch calls from initialization phase
      mockFetch.mockClear();

      // Step 2: Simulate the alarm firing (after the idle timeout passes)
      // Manually adjust the schedule to be "past due" so alarm processes it
      const schedule = syncScheduleCall[1] as { dueAt: number; actorId: string; actorType: string };
      await mockState.storage.put('syncSchedule', {
        ...schedule,
        dueAt: Date.now() - 1000, // make it past due
      });

      await session.alarm();

      // Step 3: Verify fetch was called with the snapshot containing the edit
      const syncCall = findFetchCall(mockFetch, '/internal/crdt-sync');
      expect(syncCall).toBeDefined();

      const body = extractSyncBody(syncCall);

      expect(body.siteId).toBe('aaaaaaaa-0000-4000-8000-000000000009');
      expect(body.documentId).toBe('bbbbbbbb-0000-4000-8000-000000000009');
      expect(body.branchId).toBe('cccccccc-0000-4000-8000-000000000009');
      expect(body.snapshot).toBeDefined();
      const snapshot = body.snapshot as Record<string, unknown>;
      expect(snapshot.title).toBe('E2E Title');
      expect(snapshot.content).toBe('E2E Content');
      expect(body.actorId).toBe('user-1');
      expect(body.actorType).toBe('user');

      // Step 4: After successful sync, schedule should be cleared
      const scheduleDeleted = findDeleteCall(mockState, 'syncSchedule');
      expect(scheduleDeleted).toBeDefined();
    });
  });
});
