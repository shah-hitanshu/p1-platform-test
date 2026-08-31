/**
 * Phase 3.1: Puck-Yjs Binding Utility
 *
 * Bidirectional binding between Puck data and Yjs.
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
 * Incrementally patch a Y.Map to match a plain object.
 * Only touches keys/values that actually differ, minimising Yjs operations
 * (and therefore the size of the update binary that is broadcast).
 */
export function patchYMap(
  ymap: Y.Map<unknown>,
  newObj: Record<string, unknown>,
): void {
  // Remove keys that no longer exist
  for (const key of ymap.keys()) {
    if (!(key in newObj)) {
      ymap.delete(key);
    }
  }

  for (const [key, newVal] of Object.entries(newObj)) {
    const curVal = ymap.get(key);

    // If both sides are Y.Map / plain-object, recurse
    if (
      curVal instanceof Y.Map &&
      newVal !== null &&
      typeof newVal === 'object' &&
      !Array.isArray(newVal)
    ) {
      patchYMap(curVal, newVal as Record<string, unknown>);
      continue;
    }

    // If both sides are Y.Array / plain-array, patch the array
    if (curVal instanceof Y.Array && Array.isArray(newVal)) {
      patchYArray(curVal, newVal);
      continue;
    }

    // For primitives, skip if unchanged
    if (
      !(curVal instanceof Y.Map) &&
      !(curVal instanceof Y.Array) &&
      JSON.stringify(curVal) === JSON.stringify(newVal)
    ) {
      continue;
    }

    // Value changed type or is a different primitive – replace wholesale
    ymap.set(key, toYjsValue(newVal));
  }
}

/**
 * Incrementally patch a Y.Array to match a plain array.
 * Patches items in-place where possible, appends/trims as needed.
 */
export function patchYArray(
  yarr: Y.Array<unknown>,
  newArr: unknown[],
): void {
  const minLen = Math.min(yarr.length, newArr.length);

  for (let i = 0; i < minLen; i++) {
    const curItem = yarr.get(i);
    const newItem = newArr[i];

    // If both are Y.Map / plain-object, patch in place
    if (
      curItem instanceof Y.Map &&
      newItem !== null &&
      typeof newItem === 'object' &&
      !Array.isArray(newItem)
    ) {
      patchYMap(curItem, newItem as Record<string, unknown>);
      continue;
    }

    // If both are Y.Array / plain-array, patch in place
    if (curItem instanceof Y.Array && Array.isArray(newItem)) {
      patchYArray(curItem, newItem);
      continue;
    }

    // For primitives, skip if unchanged
    if (
      !(curItem instanceof Y.Map) &&
      !(curItem instanceof Y.Array) &&
      JSON.stringify(curItem) === JSON.stringify(newItem)
    ) {
      continue;
    }

    // Different – delete and re-insert at same index
    yarr.delete(i, 1);
    yarr.insert(i, [toYjsValue(newItem)]);
  }

  // Append new items
  if (newArr.length > yarr.length) {
    const toAdd = newArr.slice(yarr.length).map((item) => toYjsValue(item));
    yarr.push(toAdd);
  }

  // Trim excess items from the end
  if (yarr.length > newArr.length) {
    yarr.delete(newArr.length, yarr.length - newArr.length);
  }
}

/**
 * Convert a Puck data structure to a Yjs Y.Map.
 * When the root map already has data, uses incremental patching to minimise
 * the number of Yjs operations (reducing flicker and broadcast size).
 *
 * @param data - The PuckData to convert
 * @param root - The Y.Map to populate
 */
export function puckDataToYMap(data: PuckData, root: Y.Map<unknown>): void {
  // Top-level no-op guard: if the Y.Doc already contains identical data,
  // skip the entire transaction. This prevents echo loops where a receiving
  // client's Puck onChange re-sends data that's already in the Y.Doc.
  if (root.size > 0) {
    const currentJson = JSON.stringify(root.toJSON());
    const newJson = JSON.stringify(data);
    if (currentJson === newJson) {
      return;
    }
  }

  root.doc?.transact(() => {
    if (root.size > 0) {
      // Incremental update – only touch what changed
      patchYMap(root, data as unknown as Record<string, unknown>);
    } else {
      // Full creation – first time populating the map.
      // Tolerate partial data (missing content/root) the same way
      // yMapToPuckData does on the read path: a document switch can seed a
      // fresh Y.Doc from a page object that has no content array yet.
      const contentArray = new Y.Array();
      for (const item of data.content ?? []) {
        contentArray.push([toYjsValue(item)]);
      }
      root.set('content', contentArray);

      // Convert root data
      root.set('root', toYjsValue(data.root ?? { props: {} }));

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
