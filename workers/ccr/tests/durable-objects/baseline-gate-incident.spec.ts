/**
 * Regression: the p1-teamworks sequence (2026-07-21/22).
 *
 * A merge auto-publish reloads the document and force-disconnects every client;
 * a stale tab auto-reconnects and re-sends its pre-merge history. Before the
 * baseline gate the DO union-merged it back in and synced it to Postgres.
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

import {
  buildHandshakeFrames,
  handleWebSocketMessage,
} from '../../src/durable-objects/websocket-connection-manager';
import type { WebSocketConnectionDeps } from '../../src/durable-objects/websocket-connection-manager';
import type { ConnectionMeta } from '../../src/types';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

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

describe('p1-teamworks incident sequence', () => {
  let staleTab: Y.Doc;
  let documentDoc: Y.Doc;

  beforeEach(() => {
    // Fixed clientIDs make LWW resolution deterministic: documentDoc (99) always
    // beats staleTab (1) so post-merge content wins when the tab is reconciled.
    staleTab = new Y.Doc();
    staleTab.clientID = 1;
    staleTab.getMap('root').set('content', 'pre-merge-content');

    documentDoc = new Y.Doc();
    documentDoc.clientID = 99;
    documentDoc.getMap('root').set('content', 'post-merge-content');
  });

  it('refuses the stale tab and keeps the merged content intact', async () => {
    const frames = buildHandshakeFrames(
      makeDeps(documentDoc),
      toBase64(Y.encodeStateVector(staleTab)),
    );
    expect(frames.verdict.gate).toBe('closed');

    // A legacy client blasts its full history before the close lands.
    const deps = makeDeps(documentDoc);
    const ws = fakeSocket({
      actorId: 'aaaaaaaa-0000-4000-8000-000000000001',
      actorType: 'user',
      verified: true,
      baselineGate: frames.verdict.gate,
    });
    await handleWebSocketMessage(
      deps,
      ws,
      toArrayBuffer(Y.encodeStateAsUpdate(staleTab)),
    );

    expect(documentDoc.getMap('root').get('content')).toBe('post-merge-content');
    expect(deps.syncManager.scheduleSync).not.toHaveBeenCalled();
  });

  it('lets the same tab back in once it has adopted the server state', async () => {
    const first = buildHandshakeFrames(
      makeDeps(documentDoc),
      toBase64(Y.encodeStateVector(staleTab)),
    );
    Y.applyUpdate(staleTab, first.stateUpdate);

    const second = buildHandshakeFrames(
      makeDeps(documentDoc),
      toBase64(Y.encodeStateVector(staleTab)),
    );
    expect(second.verdict.gate).toBe('open');

    const deps = makeDeps(documentDoc);
    const ws = fakeSocket({
      actorId: 'aaaaaaaa-0000-4000-8000-000000000001',
      actorType: 'user',
      verified: true,
      baselineGate: second.verdict.gate,
    });

    staleTab.getMap('root').set('headline', 'edit-after-recovery');
    await handleWebSocketMessage(
      deps,
      ws,
      toArrayBuffer(Y.encodeStateAsUpdate(staleTab, Y.encodeStateVector(documentDoc))),
    );

    // The gate allowed the delta through — the new edit is visible.
    expect(documentDoc.getMap('root').get('headline')).toBe('edit-after-recovery');
    // The merged post-branch content must survive — this is the incident symptom.
    // The delta is scoped to updates the server doesn't have, so pre-merge
    // content that only existed in the stale tab's history must not resurface.
    expect(documentDoc.getMap('root').get('content')).toBe('post-merge-content');
    expect(deps.syncManager.scheduleSync).toHaveBeenCalled();
  });

  // Puck stores page blocks as a Y.Array under root.content. Unlike a flat Y.Map
  // key, arrays merge additively in Yjs: union-merge does NOT remove a stale item
  // from the admitted client's local copy, so it can push the item back in when
  // it contributes its next edit. This test documents that limitation.
  //
  // The practical fix is client-side (useRealtime.ts onBaselineReset): after a
  // 4002 the client creates a fresh Y.Doc seeded from REST, so recovery goes
  // through the no_client_state gate path rather than hasLineageOverlap.
  it('documents Y.Array resurrection risk when hasLineageOverlap admits a stale tab', async () => {
    // clientID 99 (stale) > clientID 1 (server): stale wins the Y.Map LWW on
    // 'content', so the stale Y.Array replaces the post-merge Y.Array entirely.
    // This is deterministic: fixed IDs remove the random 50% outcome.
    const staleArr = new Y.Doc();
    staleArr.clientID = 99;
    const staleContent = new Y.Array<Record<string, unknown>>();
    staleContent.insert(0, [{ id: 'stale-block', type: 'TextBlock' }]);
    staleArr.getMap('root').set('content', staleContent);

    const serverArr = new Y.Doc();
    serverArr.clientID = 1;
    const serverContent = new Y.Array<Record<string, unknown>>();
    serverContent.insert(0, [{ id: 'post-block', type: 'TextBlock' }]);
    serverArr.getMap('root').set('content', serverContent);

    // staleArr absorbs the server's full state — now shares clock entries with serverArr
    const { stateUpdate } = buildHandshakeFrames(
      makeDeps(serverArr),
      toBase64(Y.encodeStateVector(staleArr)),
    );
    Y.applyUpdate(staleArr, stateUpdate);

    // Shared clock entries → hasLineageOverlap returns true → gate opens
    const second = buildHandshakeFrames(
      makeDeps(serverArr),
      toBase64(Y.encodeStateVector(staleArr)),
    );
    expect(second.verdict.gate).toBe('open');

    // staleArr contributes only the delta the server is missing
    const deps = makeDeps(serverArr);
    const ws = fakeSocket({
      actorId: 'aaaaaaaa-0000-4000-8000-000000000002',
      actorType: 'user',
      verified: true,
      baselineGate: second.verdict.gate,
    });
    await handleWebSocketMessage(
      deps,
      ws,
      toArrayBuffer(Y.encodeStateAsUpdate(staleArr, Y.encodeStateVector(serverArr))),
    );

    // staleArr's higher clientID wins the Y.Map LWW on 'content': the server ends
    // up with staleContent (stale-block only). Post-merge content is gone.
    // This is the risk: when hasLineageOverlap admits the stale tab, the stale
    // Y.Array can silently overwrite the post-merge Y.Array. A fresh Y.Doc on
    // reset (Fix 2) bypasses this — recovery goes through no_client_state, which
    // seeds from REST and never triggers the LWW conflict.
    const content = (serverArr.getMap('root').get('content') as Y.Array<Record<string, unknown>>);
    const ids = content.toArray().map((b) => b.id);
    expect(ids).toContain('stale-block'); // stale wins LWW — stale content survives
    expect(ids).not.toContain('post-block'); // post-merge content overwritten
  });

  it('accepts a first-ever client into a genuinely empty document', async () => {
    const emptyDoc = new Y.Doc();
    const author = new Y.Doc();
    author.getMap('root').set('content', 'first-draft');

    const frames = buildHandshakeFrames(
      makeDeps(emptyDoc),
      toBase64(Y.encodeStateVector(author)),
    );

    expect(frames.verdict.gate).toBe('open');
    expect(frames.verdict.reason).toBe('no_baseline');
  });
});
