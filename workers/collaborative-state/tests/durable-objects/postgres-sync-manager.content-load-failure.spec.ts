/**
 * A session whose stored content could not be loaded holds an empty Y.Doc that
 * does not represent the document. Syncing that state would replace the stored
 * content with nothing, so the write path must refuse it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { PostgresSyncManager } from '../../src/durable-objects/postgres-sync-manager';

function createSyncManager(): { manager: PostgresSyncManager } {
  const ydoc = new Y.Doc();
  const storage = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as DurableObjectStorage;

  const env = {
    INTERNAL_API_URL: 'https://internal.example.com',
    INTERNAL_SECRET: 'secret',
  } as unknown as ConstructorParameters<typeof PostgresSyncManager>[0];

  const sessionInfo = {
    siteId: 'site-1',
    documentId: 'doc-1',
    branchId: 'branch-1',
  };

  const manager = new PostgresSyncManager(env, () => sessionInfo, () => ydoc, storage);
  return { manager };
}

describe('Sync after a failed content load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  });

  it('refuses to sync when the session state was never loaded', async () => {
    const { manager } = createSyncManager();
    manager.contentLoadFailed = true;

    await manager.syncToPostgres('11111111-1111-4111-8111-111111111111', 'user');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('syncs normally when the session state loaded', async () => {
    const { manager } = createSyncManager();

    await manager.syncToPostgres('11111111-1111-4111-8111-111111111111', 'user');

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('refuses a direct sync when the session state was never loaded', async () => {
    const { manager } = createSyncManager();
    manager.contentLoadFailed = true;

    await expect(
      manager.performDirectSync(
        'https://internal.example.com',
        'secret',
        '11111111-1111-4111-8111-111111111111',
        'user',
      ),
    ).rejects.toThrow(/never loaded/);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('performs a direct sync when the session state loaded', async () => {
    const { manager } = createSyncManager();

    await manager.performDirectSync(
      'https://internal.example.com',
      'secret',
      '11111111-1111-4111-8111-111111111111',
      'user',
    );

    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
