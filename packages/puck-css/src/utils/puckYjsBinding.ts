/**
 * Phase 3.1: Puck-Yjs Binding Utility
 *
 * Bidirectional binding between Puck data and Yjs CRDT.
 * Prevents sync loops by using Yjs transaction origins.
 */

import * as Y from 'yjs';

/**
 * PuckData structure (simplified for binding purposes)
 */
export interface PuckData {
  content: PuckComponentData[];
  root: PuckRootData;
  zones?: Record<string, PuckComponentData[]>;
}

interface PuckComponentData {
  type: string;
  props: Record<string, unknown>;
}

interface PuckRootData {
  props: Record<string, unknown>;
}

/**
 * Origin marker for local changes (prevents sync loops)
 */
const LOCAL_ORIGIN = 'local';

/**
 * Convert a Puck data structure to a Yjs Y.Map.
 *
 * @param data - The PuckData to convert
 * @param root - The Y.Map to populate
 */
export function puckDataToYMap(data: PuckData, root: Y.Map<unknown>): void {
  root.doc?.transact(() => {
    // Clear existing data
    for (const key of root.keys()) {
      root.delete(key);
    }

    // Convert content array
    const contentArray = new Y.Array();
    for (const item of data.content) {
      contentArray.push([toYjsValue(item)]);
    }
    root.set('content', contentArray);

    // Convert root data
    root.set('root', toYjsValue(data.root));

    // Convert zones if present
    if (data.zones) {
      const zonesMap = new Y.Map();
      for (const [key, components] of Object.entries(data.zones)) {
        const zoneArray = new Y.Array();
        for (const component of components) {
          zoneArray.push([toYjsValue(component)]);
        }
        zonesMap.set(key, zoneArray);
      }
      root.set('zones', zonesMap);
    }
  }, LOCAL_ORIGIN);
}

/**
 * Convert a Yjs Y.Map to PuckData.
 *
 * @param root - The Y.Map containing Puck data
 * @returns The PuckData structure
 */
export function yMapToPuckData(root: Y.Map<unknown>): PuckData {
  const json = root.toJSON() as Record<string, unknown>;

  // Ensure content is an array
  const content = Array.isArray(json.content)
    ? (json.content as PuckComponentData[])
    : [];

  // Ensure root has props
  const rootData = json.root as PuckRootData | undefined;
  const rootWithProps: PuckRootData = {
    props: rootData?.props ?? {},
    ...rootData,
  };

  const result: PuckData = {
    content,
    root: rootWithProps,
  };

  // Include zones if present
  if (json.zones) {
    result.zones = json.zones as Record<string, PuckComponentData[]>;
  }

  return result;
}

/**
 * Create a bidirectional binding between Puck data and a Y.Doc.
 *
 * Uses transaction origins to prevent sync loops:
 * - Local changes use 'local' origin and don't trigger onRemoteUpdate
 * - Remote changes (any other origin) trigger onRemoteUpdate
 *
 * @param ydoc - The Y.Doc to bind to
 * @param onRemoteUpdate - Callback when remote changes arrive
 * @returns Binding interface with applyLocalChange and destroy methods
 */
export function createPuckYjsBinding(
  ydoc: Y.Doc,
  onRemoteUpdate: (data: PuckData) => void,
): { applyLocalChange: (data: PuckData) => void; destroy: () => void } {
  const root = ydoc.getMap('root');

  // Observer for remote changes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observer = (_events: any[], txn: Y.Transaction): void => {
    // Ignore local changes
    if (txn.origin === LOCAL_ORIGIN) {
      return;
    }

    // Convert Y.Map to PuckData and notify
    const puckData = yMapToPuckData(root);
    onRemoteUpdate(puckData);
  };

  // Subscribe to changes on root map
  root.observeDeep(observer);

  return {
    /**
     * Apply a local change to the Y.Doc.
     * Uses LOCAL_ORIGIN to prevent triggering onRemoteUpdate.
     */
    applyLocalChange: (data: PuckData) => {
      puckDataToYMap(data, root);
    },

    /**
     * Cleanup observers.
     */
    destroy: () => {
      root.unobserveDeep(observer);
    },
  };
}

/**
 * Convert a JavaScript value to a Yjs-compatible value.
 *
 * @param value - The value to convert
 * @returns The Yjs-compatible value
 */
function toYjsValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      const arr = new Y.Array();
      arr.push(value.map((item) => toYjsValue(item)));
      return arr;
    } else {
      const map = new Y.Map();
      for (const [k, v] of Object.entries(value)) {
        map.set(k, toYjsValue(v));
      }
      return map;
    }
  }

  return value;
}
