/**
 * Handshake frame construction for the baseline gate.
 *
 * handleWebSocket cannot run under Vitest (WebSocketPair is undefined), so the
 * frame-building half is exercised directly.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { buildHandshakeFrames } from '../../src/durable-objects/websocket-connection-manager';
import type { WebSocketConnectionDeps } from '../../src/durable-objects/websocket-connection-manager';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function depsWith(ydoc: Y.Doc): WebSocketConnectionDeps {
  return { ydoc } as unknown as WebSocketConnectionDeps;
}

describe('buildHandshakeFrames', () => {
  it('sends a delta and an open sync_baseline to a descendant client', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'server-origin');

    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    server.getMap('root').set('later', 'added-after-client-synced');

    const frames = buildHandshakeFrames(
      depsWith(server),
      toBase64(Y.encodeStateVector(client)),
    );

    expect(frames.verdict.gate).toBe('open');
    expect(frames.syncBaseline).not.toBeNull();
    expect(frames.syncBaseline?.gate).toBe('open');

    // The client applying the frame lands on the server's exact state.
    Y.applyUpdate(client, frames.stateUpdate);
    expect(client.getMap('root').get('later')).toBe('added-after-client-synced');

    // And the advertised state vector is the server's own.
    expect(frames.syncBaseline?.serverStateVector).toBe(
      toBase64(Y.encodeStateVector(server)),
    );
  });

  it('sends the full state and no sync_baseline to a diverged client', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'post-merge');

    const stale = new Y.Doc();
    stale.getMap('root').set('content', 'pre-merge');

    const frames = buildHandshakeFrames(
      depsWith(server),
      toBase64(Y.encodeStateVector(stale)),
    );

    expect(frames.verdict.gate).toBe('closed');
    expect(frames.verdict.reason).toBe('diverged');
    expect(frames.syncBaseline).toBeNull();

    // Full state, not a delta: applying it to an empty doc reproduces the server.
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, frames.stateUpdate);
    expect(fresh.getMap('root').get('content')).toBe('post-merge');
  });

  it('gives a diverged client the server clocks it needs to converge next connect', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'post-merge');

    const stale = new Y.Doc();
    stale.getMap('root').set('content', 'pre-merge');

    const frames = buildHandshakeFrames(
      depsWith(server),
      toBase64(Y.encodeStateVector(stale)),
    );

    // The client applies the state before the socket closes, so its next
    // connection is a descendant. Without this the 4002 close would loop.
    Y.applyUpdate(stale, frames.stateUpdate);

    const second = buildHandshakeFrames(
      depsWith(server),
      toBase64(Y.encodeStateVector(stale)),
    );
    expect(second.verdict.gate).toBe('open');
    expect(second.verdict.reason).toBe('descendant');
  });

  it('opens the gate against an empty server document', () => {
    const server = new Y.Doc();

    const seeded = new Y.Doc();
    seeded.getMap('root').set('content', 'first-content');

    const frames = buildHandshakeFrames(
      depsWith(server),
      toBase64(Y.encodeStateVector(seeded)),
    );

    expect(frames.verdict.gate).toBe('open');
    expect(frames.verdict.reason).toBe('no_baseline');
  });

  it('opens the gate when no state vector is supplied and the server has content', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'server-origin');

    const frames = buildHandshakeFrames(depsWith(server), null);

    // A client that omits the SV is a fresh tab or an old client. Both are safe:
    // the server sends its full state and the client pulls content forward.
    expect(frames.verdict.gate).toBe('open');
    expect(frames.verdict.reason).toBe('no_client_state');
  });
});
