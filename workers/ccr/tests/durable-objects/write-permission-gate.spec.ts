/**
 * Write admission under the per-connection edit permission.
 *
 * A socket whose principal cannot edit documents must not have its Yjs
 * updates, action metadata or publish requests honoured, while still
 * receiving state and routing presence. An absent flag means the socket
 * hibernated before the gate shipped and is treated as permitted.
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
    syncManager: { scheduleSync: vi.fn().mockResolvedValue(undefined), pendingPuckActions: [] },
    tryParseJson: (data: string) => { try { return JSON.parse(data); } catch { return null; } },
    handlePresenceMessage: vi.fn(),
    handleWsPublishRequest: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebSocketConnectionDeps;
}

/** A Yjs update that descends from the document's current state. */
function descendantUpdate(ydoc: Y.Doc, value: string): ArrayBuffer {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
  peer.getMap('root').set('content', value);
  const bytes = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const publishRequest = JSON.stringify({ type: 'publish_request', requestId: 'r-1', timestamp: 1 });
const actionMetadata = JSON.stringify({ type: 'action_metadata', puckActions: [{ type: 'insert' }] });

describe('write permission gate', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
    ydoc.getMap('root').set('content', 'original');
  });

  it('drops a Yjs frame from a connection that cannot edit, and keeps the socket open', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ canEdit: false }));

    await handleWebSocketMessage(deps, ws, descendantUpdate(ydoc, 'viewer edit'));

    expect(ydoc.getMap('root').get('content')).toBe('original');
    expect(deps.enqueueBroadcast).not.toHaveBeenCalled();
    expect(deps.markPersistPending).not.toHaveBeenCalled();
    expect(deps.syncManager.scheduleSync).not.toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('logs the refusal once per connection', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ canEdit: false }));

    await handleWebSocketMessage(deps, ws, descendantUpdate(ydoc, 'one'));
    await handleWebSocketMessage(deps, ws, descendantUpdate(ydoc, 'two'));

    const attachment = ws.deserializeAttachment() as ConnectionMeta;
    expect(attachment.writeRefusalLogged).toBe(true);
    expect(attachment.canEdit).toBe(false);
  });

  it('ignores publish requests and action metadata from a connection that cannot edit', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ canEdit: false }));

    await handleWebSocketMessage(deps, ws, publishRequest);
    await handleWebSocketMessage(deps, ws, actionMetadata);

    expect(deps.handleWsPublishRequest).not.toHaveBeenCalled();
    expect(deps.syncManager.pendingPuckActions).toHaveLength(0);
  });

  it('still routes presence from a connection that cannot edit', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ canEdit: false }));

    await handleWebSocketMessage(deps, ws, JSON.stringify({ type: 'presence_heartbeat', timestamp: 1 }));

    expect(deps.handlePresenceMessage).toHaveBeenCalled();
  });

  it('applies a Yjs frame from a connection that can edit', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta({ canEdit: true }));

    await handleWebSocketMessage(deps, ws, descendantUpdate(ydoc, 'editor edit'));

    expect(ydoc.getMap('root').get('content')).toBe('editor edit');
    expect(deps.enqueueBroadcast).toHaveBeenCalled();
    expect(deps.syncManager.scheduleSync).toHaveBeenCalled();
  });

  it('treats an absent flag as permitted so a deploy does not freeze live sessions', async () => {
    const deps = makeDeps(ydoc);
    const ws = fakeSocket(baseMeta());

    await handleWebSocketMessage(deps, ws, descendantUpdate(ydoc, 'legacy edit'));

    expect(ydoc.getMap('root').get('content')).toBe('legacy edit');
  });
});
