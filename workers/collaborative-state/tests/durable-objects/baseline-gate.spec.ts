/**
 * Baseline gate decision tests.
 *
 * The gate decides whether a connecting client's Yjs history may merge into the
 * DO's document. Pure state-vector arithmetic — no WebSocket, no Durable Object.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  decodeStateVectorParam,
  isDescendantStateVector,
  evaluateBaselineGate,
} from '../../src/durable-objects/baseline-gate';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** A doc with content, plus a replica that has seen all of it. */
function serverAndSyncedClient(): { server: Y.Doc; client: Y.Doc } {
  const server = new Y.Doc();
  server.getMap('root').set('content', 'server-origin');

  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}

describe('isDescendantStateVector', () => {
  it('returns true when the client has seen everything the server holds', () => {
    const { server, client } = serverAndSyncedClient();

    expect(
      isDescendantStateVector(
        Y.encodeStateVector(client),
        Y.encodeStateVector(server),
      ),
    ).toBe(true);
  });

  it('returns true when the client has seen the server state plus local edits', () => {
    const { server, client } = serverAndSyncedClient();
    client.getMap('root').set('extra', 'offline-edit');

    expect(
      isDescendantStateVector(
        Y.encodeStateVector(client),
        Y.encodeStateVector(server),
      ),
    ).toBe(true);
  });

  it('returns false for a client on an unrelated lineage', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'server-origin');

    const stale = new Y.Doc();
    stale.getMap('root').set('content', 'pre-merge-content');

    expect(
      isDescendantStateVector(
        Y.encodeStateVector(stale),
        Y.encodeStateVector(server),
      ),
    ).toBe(false);
  });

  it('returns false when the client has an older clock for a shared client id', () => {
    const { server, client } = serverAndSyncedClient();
    const clientSvBehind = Y.encodeStateVector(client);
    server.getMap('root').set('content', 'server-moved-on');

    expect(
      isDescendantStateVector(clientSvBehind, Y.encodeStateVector(server)),
    ).toBe(false);
  });
});

describe('decodeStateVectorParam', () => {
  it('returns null for a missing parameter', () => {
    expect(decodeStateVectorParam(null)).toBeNull();
  });

  it('returns null for an empty parameter', () => {
    expect(decodeStateVectorParam('')).toBeNull();
  });

  it('returns null for a malformed base64 parameter', () => {
    expect(decodeStateVectorParam('!!!not base64!!!')).toBeNull();
  });

  it('round-trips a real state vector', () => {
    const doc = new Y.Doc();
    doc.getMap('root').set('a', 1);
    const sv = Y.encodeStateVector(doc);

    expect(decodeStateVectorParam(toBase64(sv))).toEqual(sv);
  });
});

describe('evaluateBaselineGate', () => {
  it('opens the gate when the server has no content', () => {
    const server = new Y.Doc();
    const stale = new Y.Doc();
    stale.getMap('root').set('content', 'anything');

    const verdict = evaluateBaselineGate({
      serverHasContent: false,
      serverStateVector: Y.encodeStateVector(server),
      clientStateVector: Y.encodeStateVector(stale),
    });

    expect(verdict.gate).toBe('open');
    expect(verdict.reason).toBe('no_baseline');
  });

  it('opens the gate for a client with an empty state vector', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'server-origin');

    const verdict = evaluateBaselineGate({
      serverHasContent: true,
      serverStateVector: Y.encodeStateVector(server),
      clientStateVector: Y.encodeStateVector(new Y.Doc()),
    });

    expect(verdict.gate).toBe('open');
    expect(verdict.reason).toBe('empty_client');
  });

  it('opens the gate for a descendant client', () => {
    const { server, client } = serverAndSyncedClient();

    const verdict = evaluateBaselineGate({
      serverHasContent: true,
      serverStateVector: Y.encodeStateVector(server),
      clientStateVector: Y.encodeStateVector(client),
    });

    expect(verdict.gate).toBe('open');
    expect(verdict.reason).toBe('descendant');
  });

  it('closes the gate for a diverged client', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'post-merge');

    const stale = new Y.Doc();
    stale.getMap('root').set('content', 'pre-merge');

    const verdict = evaluateBaselineGate({
      serverHasContent: true,
      serverStateVector: Y.encodeStateVector(server),
      clientStateVector: Y.encodeStateVector(stale),
    });

    expect(verdict.gate).toBe('closed');
    expect(verdict.reason).toBe('diverged');
    expect(verdict.serverClockEntries).toBe(1);
    expect(verdict.clientClockEntries).toBe(1);
  });

  it('opens the gate when the client sent no state vector (fresh connect or old client)', () => {
    const server = new Y.Doc();
    server.getMap('root').set('content', 'post-merge');

    const verdict = evaluateBaselineGate({
      serverHasContent: true,
      serverStateVector: Y.encodeStateVector(server),
      clientStateVector: null,
    });

    // A client that omits the SV is a fresh tab or a pre-baseline-protocol
    // client. Both cases are safe: the server sends its full state and the
    // client can only pull content forward.
    expect(verdict.gate).toBe('open');
    expect(verdict.reason).toBe('no_client_state');
    expect(verdict.clientClockEntries).toBe(0);
  });
});
