/**
 * CRDT Operations for DocumentSession
 *
 * Pure functions for manipulating Yjs CRDT documents.
 * Extracted from document-session.ts for maintainability.
 */

import * as Y from 'yjs';
import { MAX_VALUE_DEPTH } from '../constants/security-limits';
import type { EditOperation } from '../types';

/**
 * Apply a JSON snapshot to a Y.Map (recursive)
 */
export function applySnapshotToYMap(ymap: Y.Map<unknown>, snapshot: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined) {
      ymap.set(key, value);
    } else if (Array.isArray(value)) {
      const yarray = new Y.Array();
      for (const item of value) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const nestedMap = new Y.Map();
          applySnapshotToYMap(nestedMap, item as Record<string, unknown>);
          yarray.push([nestedMap]);
        } else {
          yarray.push([item]);
        }
      }
      ymap.set(key, yarray);
    } else if (typeof value === 'object') {
      const nestedMap = new Y.Map();
      applySnapshotToYMap(nestedMap, value as Record<string, unknown>);
      ymap.set(key, nestedMap);
    } else {
      ymap.set(key, value);
    }
  }
}

/**
 * Convert a JavaScript value to a Yjs-compatible value
 * @param value The value to convert
 * @param depth Current recursion depth (for limiting)
 */
export function toYjsValue(value: unknown, depth = 0): unknown {
  // Security: Limit recursion depth
  if (depth > MAX_VALUE_DEPTH) {
    console.warn(`Value exceeds maximum depth of ${String(MAX_VALUE_DEPTH)}`);
    return null;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      const arr = new Y.Array();
      arr.push(value.map((item) => toYjsValue(item, depth + 1)));
      return arr;
    } else {
      const map = new Y.Map();
      for (const [k, v] of Object.entries(value)) {
        map.set(k, toYjsValue(v, depth + 1));
      }
      return map;
    }
  }

  return value;
}

/**
 * Initialize Y.Doc from a JSON snapshot
 */
export function initializeFromSnapshot(ydoc: Y.Doc, snapshot: Record<string, unknown>): void {
  const root = ydoc.getMap('root');

  // Clear existing data
  for (const key of root.keys()) {
    root.delete(key);
  }

  // Apply snapshot
  ydoc.transact(() => {
    for (const [key, value] of Object.entries(snapshot)) {
      root.set(key, toYjsValue(value));
    }
  }, 'initialize');
}

/**
 * Apply a single edit operation to the CRDT
 */
export function applyOperation(root: Y.Map<unknown>, op: EditOperation): void {
  switch (op.type) {
    case 'set':
      setNestedValue(root, op.path, op.value);
      break;

    case 'delete':
      deleteNestedValue(root, op.path);
      break;

    case 'insert':
      if (op.index !== undefined) {
        insertIntoArray(root, op.path, op.index, op.value);
      }
      break;

    case 'move':
      if (op.fromIndex !== undefined && op.toIndex !== undefined) {
        moveInArray(root, op.path, op.fromIndex, op.toIndex);
      }
      break;

    case 'replace':
      setNestedValue(root, op.path, op.content);
      break;
  }
}

/**
 * Set a value at a nested path in the Yjs document
 * Path format: "key1.key2.key3" or "content.0.props.title" (with array indices)
 */
export function setNestedValue(root: Y.Map<unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Y.Map<unknown> | Y.Array<unknown> = root;

  // Navigate to parent, handling both maps and arrays
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const isNumericIndex = /^\d+$/.test(key);

    let next: unknown;

    if (current instanceof Y.Array) {
      // Current is an array, key should be a numeric index
      if (!isNumericIndex) {
        throw new Error(`Expected numeric index for array at path segment "${String(key)}"`);
      }
      const index = parseInt(key, 10);
      next = current.get(index);
    } else {
      // Current is a map
      next = current.get(key);
    }

    // Check if next segment is a numeric index to determine type
    const nextKey = parts[i + 1];
    const nextIsNumericIndex = nextKey !== undefined && /^\d+$/.test(nextKey);

    if (next instanceof Y.Map || next instanceof Y.Array) {
      current = next;
    } else if (next === undefined || next === null) {
      // Create appropriate type based on next path segment
      if (nextIsNumericIndex) {
        const newArray = new Y.Array();
        if (current instanceof Y.Array) {
          // Can't easily set in array - this is an edge case
          throw new Error('Cannot create nested structure in array');
        } else {
          current.set(key, newArray);
        }
        current = newArray;
      } else {
        const newMap = new Y.Map();
        if (current instanceof Y.Array) {
          throw new Error('Cannot create nested structure in array');
        } else {
          current.set(key, newMap);
        }
        current = newMap;
      }
    } else {
      // Value exists but is not a Y.Map or Y.Array - it's likely a plain object
      // from the JSON structure that needs to be navigated
      throw new Error(`Cannot navigate through non-container value at path segment "${String(key)}"`);
    }
  }

  // Set the final value
  const finalKey = parts[parts.length - 1];
  const isNumericIndex = /^\d+$/.test(finalKey);

  if (current instanceof Y.Array) {
    if (!isNumericIndex) {
      throw new Error(`Expected numeric index for array at final path segment "${String(finalKey)}"`);
    }
    const index = parseInt(finalKey, 10);
    // For arrays, we need to delete and insert to replace
    if (index < current.length) {
      current.delete(index, 1);
    }
    current.insert(index, [toYjsValue(value)]);
  } else {
    current.set(finalKey, toYjsValue(value));
  }
}

/**
 * Delete a value at a nested path
 * Path format: "key1.key2.key3" or "content.0.props.title" (with array indices)
 */
export function deleteNestedValue(root: Y.Map<unknown>, path: string): void {
  const parts = path.split('.');
  let current: Y.Map<unknown> | Y.Array<unknown> = root;

  // Navigate to parent, handling both maps and arrays
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const isNumericIndex = /^\d+$/.test(key);

    let next: unknown;

    if (current instanceof Y.Array) {
      if (!isNumericIndex) {
        return; // Invalid path for array
      }
      const index = parseInt(key, 10);
      next = current.get(index);
    } else {
      next = current.get(key);
    }

    if (next instanceof Y.Map || next instanceof Y.Array) {
      current = next;
    } else {
      return; // Path doesn't exist
    }
  }

  // Delete the final key
  const finalKey = parts[parts.length - 1];
  const isNumericIndex = /^\d+$/.test(finalKey);

  if (current instanceof Y.Array) {
    if (!isNumericIndex) {
      return; // Invalid path for array
    }
    const index = parseInt(finalKey, 10);
    if (index < current.length) {
      current.delete(index, 1);
    }
  } else {
    current.delete(finalKey);
  }
}

/**
 * Insert a value into an array at the given path and index
 */
export function insertIntoArray(root: Y.Map<unknown>, path: string, index: number, value: unknown): void {
  const arr = getArrayAtPath(root, path);
  if (arr) {
    arr.insert(index, [toYjsValue(value)]);
  }
}

/**
 * Move an element within an array
 */
export function moveInArray(root: Y.Map<unknown>, path: string, fromIndex: number, toIndex: number): void {
  const arr = getArrayAtPath(root, path);
  if (arr && fromIndex < arr.length) {
    // Get the item to move
    const item = arr.get(fromIndex);

    // Remove from old position
    arr.delete(fromIndex, 1);

    // Adjust toIndex if necessary (after removal)
    const adjustedToIndex = toIndex > fromIndex ? toIndex : toIndex;

    // Insert at new position
    arr.insert(adjustedToIndex, [item]);
  }
}

/**
 * Get or create a Y.Array at the given path
 * Path format: "key1.key2.key3" or "content.0.items" (with array indices)
 */
export function getArrayAtPath(root: Y.Map<unknown>, path: string): Y.Array<unknown> | null {
  const parts = path.split('.');
  let current: Y.Map<unknown> | Y.Array<unknown> = root;

  // Navigate to parent, handling both maps and arrays
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const isNumericIndex = /^\d+$/.test(key);

    let next: unknown;

    if (current instanceof Y.Array) {
      if (!isNumericIndex) {
        return null; // Invalid path for array
      }
      const index = parseInt(key, 10);
      next = current.get(index);
    } else {
      next = current.get(key);
    }

    if (next instanceof Y.Map || next instanceof Y.Array) {
      current = next;
    } else if (next === undefined || next === null) {
      // Create a map for missing intermediate paths
      if (current instanceof Y.Array) {
        return null; // Can't create in array
      }
      const newMap = new Y.Map();
      current.set(key, newMap);
      current = newMap;
    } else {
      return null; // Path doesn't exist as container
    }
  }

  // Get or create the final array
  const finalKey = parts[parts.length - 1];
  const isNumericIndex = /^\d+$/.test(finalKey);

  let arr: unknown;
  if (current instanceof Y.Array) {
    if (!isNumericIndex) {
      return null;
    }
    arr = current.get(parseInt(finalKey, 10));
  } else {
    arr = current.get(finalKey);
  }

  if (arr instanceof Y.Array) {
    return arr;
  }

  // If it's a regular array, convert it
  if (Array.isArray(arr)) {
    const yArray = new Y.Array();
    yArray.push(arr.map((item) => toYjsValue(item)));
    if (current instanceof Y.Array) {
      // Can't easily replace in Y.Array, return null
      return null;
    }
    current.set(finalKey, yArray);
    return yArray;
  }

  return null;
}
