/**
 * The service behind `/apply`, driven with a fake sync manager so each branch of
 * the write path (pending edits first, sync at once, fall back to a schedule)
 * can be seen on its own.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as Y from 'yjs';
import {
  applyOperations,
  ApplyOperationsError,
  type ApplyOperationsDeps,
} from '../../src/durable-objects/apply-operations';
import type { EditSession } from '../../src/durable-objects/document-session-types';
import type { PostgresSyncManager } from '../../src/durable-objects/postgres-sync-manager';
import type { ActivityDetector } from '../../src/services/activity-detection-service';

const USER_ID = '55555555-5555-4555-8555-555555555555';
const attribution = {
  agent: { id: 'agent-1', name: 'Copy Editor' },
  onBehalfOf: { id: USER_ID, name: 'Ada Lovelace' },
  description: 'Shorten the headline',
};

type SyncManagerMocks = Record<'hasUnsyncedChanges' | 'flushAndSync' | 'performDirectSync' | 'scheduleSync', Mock>;

function createSyncManager(overrides: Partial<SyncManagerMocks> = {}): SyncManagerMocks {
  return {
    hasUnsyncedChanges: vi.fn().mockReturnValue(false),
    flushAndSync: vi.fn().mockResolvedValue('v-0'),
    performDirectSync: vi.fn().mockResolvedValue(undefined),
    scheduleSync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createDeps(syncManager: ReturnType<typeof createSyncManager>, editSessions: EditSession[] = []) {
  const ydoc = new Y.Doc();
  const activityDetector = { recordHumanActivity: vi.fn() };
  const deps: ApplyOperationsDeps = {
    getYdoc: () => ydoc,
    env: { INTERNAL_API_URL: 'http://api', INTERNAL_SECRET: 's3' },
    editSessions: new Map(editSessions.map((session) => [session.id, session])),
    activityDetector: activityDetector as unknown as ActivityDetector,
    syncManager: syncManager as unknown as PostgresSyncManager,
    persist: vi.fn().mockResolvedValue(undefined),
    flushPendingPersist: vi.fn().mockResolvedValue(undefined),
    broadcastUpdate: vi.fn(),
    scheduleCleanupAlarm: vi.fn().mockResolvedValue(undefined),
  };
  return { deps, ydoc, activityDetector };
}

const setTitle = { type: 'set' as const, path: 'title', value: 'Hello' };
const user = { id: USER_ID, type: 'user' as const };

describe('applyOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies, persists, broadcasts and schedules a sync for a plain write', async () => {
    const syncManager = createSyncManager();
    const { deps, ydoc } = createDeps(syncManager);

    const result = await applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: { actorName: 'Ada' },
    });

    expect(result.snapshot).toEqual({ title: 'Hello' });
    expect(ydoc.getMap('root').toJSON()).toEqual({ title: 'Hello' });
    expect(deps.persist).toHaveBeenCalledOnce();
    expect(deps.broadcastUpdate).toHaveBeenCalledOnce();
    expect(syncManager.scheduleSync).toHaveBeenCalledWith(USER_ID, 'user', { actorName: 'Ada' });
    expect(syncManager.performDirectSync).not.toHaveBeenCalled();
    expect(syncManager.flushAndSync).not.toHaveBeenCalled();
  });

  it('syncs an attributed write at once, under the attribution', async () => {
    const syncManager = createSyncManager();
    const { deps } = createDeps(syncManager);

    await applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: {}, attribution,
    });

    expect(syncManager.performDirectSync).toHaveBeenCalledWith('http://api', 's3', USER_ID, 'user', { attribution });
    expect(syncManager.scheduleSync).not.toHaveBeenCalled();
  });

  it('writes the edits already waiting before an attributed write', async () => {
    const syncManager = createSyncManager({ hasUnsyncedChanges: vi.fn().mockReturnValue(true) });
    const { deps } = createDeps(syncManager);

    await applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: {}, attribution,
    });

    expect(syncManager.flushAndSync).toHaveBeenCalledWith(deps.flushPendingPersist, { actorId: USER_ID, actorType: 'user' });
    expect(syncManager.flushAndSync.mock.invocationCallOrder[0])
      .toBeLessThan(syncManager.performDirectSync.mock.invocationCallOrder[0] ?? 0);
  });

  it('refuses the attributed write, leaving the document alone, when those edits cannot be written', async () => {
    const syncManager = createSyncManager({
      hasUnsyncedChanges: vi.fn().mockReturnValue(true),
      flushAndSync: vi.fn().mockRejectedValue(new Error('postgres away')),
    });
    const { deps, ydoc } = createDeps(syncManager);

    const attempt = applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: {}, attribution,
    });

    await expect(attempt).rejects.toBeInstanceOf(ApplyOperationsError);
    await expect(attempt).rejects.toMatchObject({ status: 503 });
    expect(ydoc.getMap('root').toJSON()).toEqual({});
    expect(deps.persist).not.toHaveBeenCalled();
    expect(syncManager.performDirectSync).not.toHaveBeenCalled();
    expect(syncManager.scheduleSync).not.toHaveBeenCalled();
  });

  it('falls back to scheduling, attribution kept, when the immediate sync fails', async () => {
    const syncManager = createSyncManager({
      performDirectSync: vi.fn().mockRejectedValue(new Error('503')),
    });
    const { deps } = createDeps(syncManager);

    await applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: { actorName: 'Ada' }, attribution,
    });

    expect(syncManager.scheduleSync).toHaveBeenCalledWith(USER_ID, 'user', { actorName: 'Ada', attribution });
  });

  it('only schedules when the lane has no internal API, attribution or not', async () => {
    const syncManager = createSyncManager({ hasUnsyncedChanges: vi.fn().mockReturnValue(true) });
    const { deps } = createDeps(syncManager);
    deps.env = {};

    await applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: {}, attribution,
    });

    expect(syncManager.flushAndSync).not.toHaveBeenCalled();
    expect(syncManager.performDirectSync).not.toHaveBeenCalled();
    expect(syncManager.scheduleSync).toHaveBeenCalledWith(USER_ID, 'user', { attribution });
  });

  it('reports a bad operation without persisting', async () => {
    const syncManager = createSyncManager();
    const { deps } = createDeps(syncManager);

    const attempt = applyOperations(deps, {
      actor: user,
      operations: [setTitle, { type: 'set', path: 'title.inner', value: 'x' }],
      syncActorId: USER_ID,
      identity: {},
    });

    await expect(attempt).rejects.toMatchObject({ status: 400 });
    expect(deps.persist).not.toHaveBeenCalled();
    expect(syncManager.scheduleSync).not.toHaveBeenCalled();
  });

  it('puts other sessions whose regions the write touched into conflict, not the actor\'s own', async () => {
    const own: EditSession = {
      id: 'own', ownerId: USER_ID, ownerType: 'user', trigger: 'manual', intent: '', targetRegions: ['title'], startedAt: 0,
    };
    const other: EditSession = {
      id: 'other', ownerId: 'agent-9', ownerType: 'agent', trigger: 'manual', intent: '', targetRegions: ['title'], startedAt: 0,
    };
    const { deps, activityDetector } = createDeps(createSyncManager(), [own, other]);

    const result = await applyOperations(deps, {
      actor: user, operations: [setTitle], syncActorId: USER_ID, identity: {},
    });

    expect(result.sessionConflicts).toEqual([
      { ownerId: 'agent-9', ownerType: 'agent', regions: ['title'], sessionId: 'other' },
    ]);
    expect(other.conflicted).toBe(true);
    expect(own.conflicted).toBeUndefined();
    expect(activityDetector.recordHumanActivity).toHaveBeenCalledWith(USER_ID, ['title']);
  });
});
