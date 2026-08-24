/**
 * Baseline gate: decides whether a connecting client's Yjs history is allowed to
 * merge into this document's state. Pure state-vector arithmetic, no I/O, so it
 * is testable without a WebSocket (WebSocketPair is undefined under Vitest).
 */

import * as Y from 'yjs';

export type BaselineGateState = 'open' | 'closed';

export type BaselineGateReason =
  | 'no_baseline'
  | 'empty_client'
  | 'descendant'
  | 'diverged'
  | 'no_client_state';

export interface BaselineGateVerdict {
  gate: BaselineGateState;
  reason: BaselineGateReason;
  /** Distinct Yjs client ids in the server's state vector — diagnostic only. */
  serverClockEntries: number;
  /** Distinct Yjs client ids in the client's state vector — diagnostic only. */
  clientClockEntries: number;
}

/**
 * Decode the base64 `stateVector` query parameter. Returns null when absent or
 * unparseable — a client that cannot state where it stands is treated as unknown,
 * not as up to date.
 */
export function decodeStateVectorParam(param: string | null): Uint8Array | null {
  if (param === null || param === '') {
    return null;
  }
  try {
    const binary = atob(param);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    Y.decodeStateVector(bytes);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * True when the client has already seen every update the server holds: for each
 * (clientId, clock) the server knows, the client knows that clientId at an equal
 * or higher clock. Yjs merges by union, so this is the only way to tell a genuine
 * offline edit apart from a foreign lineage.
 */
export function isDescendantStateVector(
  clientSv: Uint8Array,
  serverSv: Uint8Array,
): boolean {
  const client = Y.decodeStateVector(clientSv);
  const server = Y.decodeStateVector(serverSv);

  for (const [clientId, clock] of server) {
    const seen = client.get(clientId);
    if (seen === undefined || seen < clock) {
      return false;
    }
  }
  return true;
}

/**
 * Decide the gate for one connection. Keyed on whether the server holds content
 * rather than on how it was loaded, so nothing has to survive hibernation.
 */
export function evaluateBaselineGate(params: {
  serverHasContent: boolean;
  serverStateVector: Uint8Array;
  clientStateVector: Uint8Array | null;
}): BaselineGateVerdict {
  const { serverHasContent, serverStateVector, clientStateVector } = params;

  const serverClockEntries = Y.decodeStateVector(serverStateVector).size;
  const clientClockEntries =
    clientStateVector === null ? 0 : Y.decodeStateVector(clientStateVector).size;

  const base = { serverClockEntries, clientClockEntries };

  // An empty document has nothing to protect: this is how a new document gets
  // its first content.
  if (!serverHasContent) {
    return { gate: 'open', reason: 'no_baseline', ...base };
  }

  if (clientStateVector === null) {
    // No state vector means a fresh connect or an old client that predates the
    // baseline protocol. Admit it: the server will send its full state and the
    // client can only pull content forward, not resurrect pre-merge history.
    return { gate: 'open', reason: 'no_client_state', ...base };
  }

  if (clientClockEntries === 0) {
    return { gate: 'open', reason: 'empty_client', ...base };
  }

  if (isDescendantStateVector(clientStateVector, serverStateVector)) {
    return { gate: 'open', reason: 'descendant', ...base };
  }

  // A client that shares at least one clientId with the server is on the same
  // lineage — it's just behind and needs a delta, not a rejection.
  const clientSvMap = Y.decodeStateVector(clientStateVector);
  const serverSvMap = Y.decodeStateVector(serverStateVector);
  const hasLineageOverlap = [...clientSvMap.keys()].some(id => serverSvMap.has(id));
  if (hasLineageOverlap) {
    return { gate: 'open', reason: 'descendant', ...base };
  }

  return { gate: 'closed', reason: 'diverged', ...base };
}
