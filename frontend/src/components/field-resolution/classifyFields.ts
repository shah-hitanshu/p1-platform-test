/**
 * Classify Fields
 *
 * Pure function that compares source and target snapshots against a base
 * snapshot to classify each changed field as source-only, target-only,
 * or conflicting.
 */

import { generateFieldLabel } from '../content-diff/transformDiffOperations';
import type { FieldClassification } from './types';

// Re-export for test imports
export type { FieldClassification };

/**
 * Deep equality check for values (handles objects, arrays, primitives).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * Get a value at a path from an object, or undefined if not present.
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
 * Collect all leaf paths from an object (stops at arrays and primitives).
 */
function collectPaths(
  obj: Record<string, unknown>,
  prefix: string = ''
): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const path = `${prefix}/${key}`;
    const value = obj[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      paths.push(...collectPaths(value as Record<string, unknown>, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Classify fields between source and target snapshots relative to an optional base.
 * With a base snapshot, determines which branch changed each field (source-only, target-only, or conflicting).
 * Without a base, all differing fields are classified as conflicting.
 *
 * @param source - The source branch snapshot.
 * @param target - The target branch snapshot.
 * @param base - The common ancestor snapshot, or null if unavailable.
 * @returns An array of classified fields with their values from each snapshot.
 */
export function classifyFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  base: Record<string, unknown> | null
): FieldClassification[] {
  const results: FieldClassification[] = [];

  // Collect all unique leaf paths from all snapshots
  const allPaths = new Set<string>();
  collectPaths(source).forEach((p) => allPaths.add(p));
  collectPaths(target).forEach((p) => allPaths.add(p));
  if (base !== null) {
    collectPaths(base).forEach((p) => allPaths.add(p));
  }

  for (const path of allPaths) {
    const sourceValue = getAtPath(source, path);
    const targetValue = getAtPath(target, path);

    // If source and target are the same, no classification needed
    const sourceHas = hasPath(source, path);
    const targetHas = hasPath(target, path);

    if (sourceHas && targetHas && deepEqual(sourceValue, targetValue)) {
      continue;
    }
    if (!sourceHas && !targetHas) {
      continue;
    }

    if (base === null) {
      // Without base, any difference is a conflict
      results.push({
        fieldPath: path,
        label: generateFieldLabel(path),
        classification: 'conflicting',
        sourceValue: sourceHas ? sourceValue : undefined,
        targetValue: targetHas ? targetValue : undefined,
      });
      continue;
    }

    const baseValue = getAtPath(base, path);
    const baseHas = hasPath(base, path);

    const sourceChanged = sourceHas !== baseHas || !deepEqual(sourceValue, baseValue);
    const targetChanged = targetHas !== baseHas || !deepEqual(targetValue, baseValue);

    if (sourceChanged && targetChanged) {
      results.push({
        fieldPath: path,
        label: generateFieldLabel(path),
        classification: 'conflicting',
        sourceValue: sourceHas ? sourceValue : undefined,
        targetValue: targetHas ? targetValue : undefined,
        baseValue: baseHas ? baseValue : undefined,
      });
    } else if (sourceChanged) {
      results.push({
        fieldPath: path,
        label: generateFieldLabel(path),
        classification: 'source-only',
        sourceValue: sourceHas ? sourceValue : undefined,
        targetValue: targetHas ? targetValue : undefined,
        baseValue: baseHas ? baseValue : undefined,
      });
    } else if (targetChanged) {
      results.push({
        fieldPath: path,
        label: generateFieldLabel(path),
        classification: 'target-only',
        sourceValue: sourceHas ? sourceValue : undefined,
        targetValue: targetHas ? targetValue : undefined,
        baseValue: baseHas ? baseValue : undefined,
      });
    }
  }

  return results;
}
