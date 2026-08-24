/**
 * Binary frame admission under the baseline gate.
 *
 * A socket whose gate is closed must not have its Yjs updates applied, however
 * they arrive. An absent gate means the socket hibernated before the gate
 * shipped and is treated as open.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

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

import { handleWebSocketMessage } from '../../src/durable-objects/websocket-connection-manager';
import type { WebSocketConnectionDeps } from '../../src/durable-objects/websocket-connection-manager';
import type { ConnectionMeta } from '../../src/types';

function fakeSocket(meta: ConnectionMeta): WebSocket {
  let attachment: unknown = meta;
  return {
    deserializeAttachment: () => attachment,
    serializeAttachment: (value: unknown) => { attachment = value; },
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as unknown as WebSocket;
}

function baseMeta(overrides: Partial<ConnectionMeta> = {}): ConnectionMeta {
  return {
    actorId: 'aaaaaaaa-0000-4000-8000-000000000001',
    actorType: 'user',
    verified: true,
    ...overrides,
  };
}

function makeDeps(ydoc: Y.Doc): WebSocketConnectionDeps {
  return {
    ydoc,
    sessionInfo: { siteId: 'site-1', documentId: 'doc-1', branchId: 'branch-1' },
    messageRates: new Map(),
    restoreSessionInfoFromStorage: vi.fn().mockResolvedValue(undefined),
    initializeCrdtIfNeeded: vi.fn().mockResolvedValue(undefined),
    enqueueBroadcast: vi.fn(),
    markPersistPending: vi.fn().mockResolvedValue(undefined),
    syncManager: { scheduleSync: vi.fn().mockResolvedValue(undefined) },
    tryParseJson: (data: string) => { try { return JSON.parse(data); } catch { return null; } },
    handlePresenceMessage: vi.fn(),
  } as unknown as WebSocketConnectionDeps;
}

/** A Yjs update from an unrelated lineage. */
function foreignUpdate(): ArrayBuffer {
  const stale = new Y.Doc();
  stale.getMap('root').set('content', 'pre-merge');
  const bytes = Y.encodeStateAsUpdate(stale);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('baseline gate admission', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
    ydoc.getMap('root').set('content', 'post-merge');
  });

  it('does not apply an update from a closed-gate socket', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ baselineGate: 'closed' }));

    await handleWebSocketMessage(deps, ws, foreignUpdate());

    expect(ydoc.getMap('root').get('content')).toBe('post-merge');
    expect(deps.enqueueBroadcast).not.toHaveBeenCalled();
    expect(deps.syncManager.scheduleSync).not.toHaveBeenCalled();
  });

  it('applies an update from an open-gate socket', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ baselineGate: 'open' }));

    await handleWebSocketMessage(deps, ws, foreignUpdate());

    expect(deps.enqueueBroadcast).toHaveBeenCalled();
    expect(deps.syncManager.scheduleSync).toHaveBeenCalled();
  });

  it('treats an absent gate as open so a deploy does not freeze live sessions', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta());

    await handleWebSocketMessage(deps, ws, foreignUpdate());

    expect(deps.enqueueBroadcast).toHaveBeenCalled();
  });

  it('logs the first dropped frame only once per socket', async () => {
    const deps = makeDeps(ydoc);
    const meta = baseMeta({ baselineGate: 'closed' });
    const ws = fakeSocket(meta);

    await handleWebSocketMessage(deps, ws, foreignUpdate());
    await handleWebSocketMessage(deps, ws, foreignUpdate());

    const attachment = ws.deserializeAttachment() as ConnectionMeta;
    expect(attachment.baselineDropLogged).toBe(true);
  });

  it('still routes presence text frames on a closed-gate socket', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ baselineGate: 'closed' }));

    await handleWebSocketMessage(
      deps,
      ws,
      JSON.stringify({ type: 'presence_heartbeat', timestamp: 1 }),
    );

    expect(deps.handlePresenceMessage).toHaveBeenCalled();
  });
});
