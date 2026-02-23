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
 * Binding state interface - encapsulates instance-specific state
 * to prevent interference between multiple binding instances.
 */
interface BindingState {
  /**
   * Flag to track if we're currently applying a local change.
   * Used to prevent the observer from firing during local changes,
   * even if there are edge cases with transaction origins.
   */
  isApplyingLocalChange: boolean;

  /**
   * Flag set when destroy() is called. Prevents applyLocalChange from
   * writing to the Y.Doc after the binding has been torn down. This is
   * critical during document switches where a stale binding reference
   * could otherwise write the wrong document's data into the Y.Doc.
   */
  destroyed: boolean;
}

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

  // Instance-specific state to prevent interference between multiple bindings
  // Previously this was a module-level variable which caused race conditions
  // when multiple binding instances existed in the same browser window
  const bindingState: BindingState = {
    isApplyingLocalChange: false,
    destroyed: false,
  };

  // Observer for remote changes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observer = (_events: any[], txn: Y.Transaction): void => {
    // Double-check: skip if we're in the middle of applying a local change
    // This handles any edge cases where transaction origin might not be set correctly
    if (bindingState.isApplyingLocalChange) {
      return;
    }

    // Ignore local changes by transaction origin
    if (txn.origin === LOCAL_ORIGIN) {
      return;
    }

    // Convert Y.Map to PuckData and notify
    const puckData = yMapToPuckData(root);

    // Guard against empty Yjs initial sync state. When a new Yjs document
    // connects, the first sync may produce an empty snapshot ({} or
    // { content: [], root: { props: {} } }). Applying this would overwrite
    // real editor content and trigger a save loop.
    if (puckData.content.length === 0 && Object.keys(puckData.root.props).length === 0 && !puckData.zones) {
      return;
    }

    onRemoteUpdate(puckData);
  };

  // Subscribe to changes on root map
  root.observeDeep(observer);

  return {
    /**
     * Apply a local change to the Y.Doc.
     * Uses LOCAL_ORIGIN to prevent triggering onRemoteUpdate.
     * Also sets isApplyingLocalChange flag as a backup mechanism.
     */
    applyLocalChange: (data: PuckData) => {
      // Prevent writes through a destroyed binding (cross-document state bleed guard)
      if (bindingState.destroyed) {
        return;
      }
      bindingState.isApplyingLocalChange = true;
      try {
        puckDataToYMap(data, root);
      } finally {
        bindingState.isApplyingLocalChange = false;
      }
    },

    /**
     * Cleanup observers and mark as destroyed.
     * After destroy(), applyLocalChange becomes a no-op.
     * Idempotent: safe to call multiple times (e.g. React strict mode
     * double-unmount where both useLayoutEffect and useEffect cleanups fire).
     */
    destroy: () => {
      if (bindingState.destroyed) return;
      bindingState.destroyed = true;
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
