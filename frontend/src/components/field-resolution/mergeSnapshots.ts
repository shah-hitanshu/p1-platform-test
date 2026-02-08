/**
 * Merge Snapshots
 *
 * Pure function that takes source and target snapshots plus user field
 * selections and produces a merged snapshot.
 */

import type { FieldSelection } from './types';

// Re-export for test imports
export type { FieldSelection };

/**
 * Deep clone an object.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Get a value at a JSON pointer path.
 */
function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('/').filter(Boolean);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Dangerous property names that could lead to prototype pollution. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Set a value at a JSON pointer path, creating intermediate objects as needed.
 * Rejects paths containing prototype-polluting keys.
 */
function setAtPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = path.split('/').filter(Boolean);
  if (segments.some((seg) => UNSAFE_KEYS.has(seg))) return;
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!(seg in current) || typeof current[seg] !== 'object' || current[seg] === null) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  const lastSeg = segments[segments.length - 1];
  current[lastSeg] = value;
}

/**
 * Delete a value at a JSON pointer path.
 * Rejects paths containing prototype-polluting keys.
 */
function deleteAtPath(obj: Record<string, unknown>, path: string): void {
  const segments = path.split('/').filter(Boolean);
  if (segments.some((seg) => UNSAFE_KEYS.has(seg))) return;
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!(seg in current) || typeof current[seg] !== 'object' || current[seg] === null) {
      return;
    }
    current = current[seg] as Record<string, unknown>;
  }
  const lastSeg = segments[segments.length - 1];
  delete current[lastSeg];
}

/**
 * Check if a path exists in an object.
 */
function hasPath(obj: Record<string, unknown>, path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    if (!(seg in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[seg];
  }
  return true;
}

/**
 * Merge two snapshots using field-level selections to produce a resolved snapshot.
 * Starts with a deep clone of the target, then applies each user selection
 * ('source', 'target', or 'custom') to the corresponding field path.
 *
 * @param source - The source branch snapshot.
 * @param target - The target branch snapshot (used as the merge base).
 * @param selections - Per-field resolution choices from the user.
 * @returns A new merged snapshot with all selections applied.
 */
export function mergeSnapshots(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  selections: FieldSelection[]
): Record<string, unknown> {
  const result = deepClone(target);

  for (const selection of selections) {
    const { fieldPath, choice, customValue } = selection;

    switch (choice) {
      case 'source': {
        if (hasPath(source, fieldPath)) {
          setAtPath(result, fieldPath, deepClone(getAtPath(source, fieldPath)));
        } else {
          // Source doesn't have this field = it was removed in source
          deleteAtPath(result, fieldPath);
        }
        break;
      }
      case 'target':
        // No-op: target value is already in result
        break;
      case 'custom':
        setAtPath(result, fieldPath, customValue);
        break;
    }
  }

  return result;
}
