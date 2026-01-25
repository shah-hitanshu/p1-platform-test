/**
 * Diff Utility
 *
 * Functions for comparing Puck data structures to identify changes.
 */

import type { PuckData, PuckComponentData } from '@pantheon/css-client';
import type { ComponentDiff, ComponentDiffWithPosition, PropDiff } from '../types.js';

/**
 * Generates a unique key for a component based on its ID and path.
 */
function getComponentKey(component: PuckComponentData, path: string[]): string {
  return `${path.join('/')}/${component.props.id}`;
}

/**
 * Flattens a Puck data structure into a map of component ID to component data.
 */
function flattenComponents(
  data: PuckData
): Map<string, { component: PuckComponentData; path: string[] }> {
  const result = new Map<string, { component: PuckComponentData; path: string[] }>();

  // Process main content (handle undefined/null content)
  const content = data?.content ?? [];
  for (const component of content) {
    const path = ['content'];
    result.set(getComponentKey(component, path), { component, path });
  }

  // Process zones
  if (data?.zones) {
    for (const [zoneName, components] of Object.entries(data.zones)) {
      for (const component of components ?? []) {
        const path = ['zones', zoneName];
        result.set(getComponentKey(component, path), { component, path });
      }
    }
  }

  return result;
}

/**
 * Deeply compares two objects for equality.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

/**
 * Compares two Puck data structures and returns a list of component differences.
 *
 * @param before - The original Puck data
 * @param after - The modified Puck data
 * @returns Array of component differences
 *
 * @example
 * ```typescript
 * const diffs = diffPuckData(oldData, newData);
 * for (const diff of diffs) {
 *   if (diff.type === 'added') {
 *     console.log(`Added: ${diff.componentType}`);
 *   }
 * }
 * ```
 */
export function diffPuckData(before: PuckData, after: PuckData): ComponentDiff[] {
  const diffs: ComponentDiff[] = [];

  const beforeComponents = flattenComponents(before);
  const afterComponents = flattenComponents(after);

  // Find removed and modified components
  for (const [key, { component, path }] of beforeComponents) {
    const afterEntry = afterComponents.get(key);

    if (!afterEntry) {
      // Component was removed
      diffs.push({
        type: 'removed',
        componentId: component.props.id,
        componentType: component.type,
        path,
        before: component,
      });
    } else if (!deepEqual(component, afterEntry.component)) {
      // Component was modified
      diffs.push({
        type: 'modified',
        componentId: component.props.id,
        componentType: component.type,
        path,
        before: component,
        after: afterEntry.component,
      });
    } else {
      // Component is unchanged
      diffs.push({
        type: 'unchanged',
        componentId: component.props.id,
        componentType: component.type,
        path,
        before: component,
        after: afterEntry.component,
      });
    }
  }

  // Find added components
  for (const [key, { component, path }] of afterComponents) {
    if (!beforeComponents.has(key)) {
      diffs.push({
        type: 'added',
        componentId: component.props.id,
        componentType: component.type,
        path,
        after: component,
      });
    }
  }

  return diffs;
}

/**
 * Filters diffs to only include changes (excludes unchanged components).
 */
export function getChangedComponents(diffs: ComponentDiff[]): ComponentDiff[] {
  return diffs.filter((diff) => diff.type !== 'unchanged');
}

/**
 * Counts the number of changes by type.
 */
export function countChanges(diffs: ComponentDiff[]): {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
} {
  const counts = { added: 0, removed: 0, modified: 0, unchanged: 0 };

  for (const diff of diffs) {
    counts[diff.type]++;
  }

  return counts;
}

/**
 * Checks if the root props have changed between two Puck data objects.
 */
export function hasRootChanged(before: PuckData, after: PuckData): boolean {
  return !deepEqual(before.root, after.root);
}

/**
 * Flattens components with their indices for position tracking.
 */
function flattenComponentsWithIndex(
  data: PuckData
): Map<string, { component: PuckComponentData; path: string[]; index: number }> {
  const result = new Map<string, { component: PuckComponentData; path: string[]; index: number }>();

  // Process main content (handle undefined/null content)
  const content = data?.content ?? [];
  content.forEach((component, index) => {
    const path = ['content'];
    const key = `${component.props.id}`;
    result.set(key, { component, path, index });
  });

  // Process zones
  if (data?.zones) {
    for (const [zoneName, components] of Object.entries(data.zones)) {
      (components ?? []).forEach((component, index) => {
        const path = ['zones', zoneName];
        const key = `${zoneName}/${component.props.id}`;
        result.set(key, { component, path, index });
      });
    }
  }

  return result;
}

/**
 * Compares two Puck data structures with position tracking and reorder detection.
 *
 * @param before - The original Puck data
 * @param after - The modified Puck data
 * @returns Array of component differences with position info
 */
export function diffPuckDataWithPositions(
  before: PuckData,
  after: PuckData
): ComponentDiffWithPosition[] {
  const diffs: ComponentDiffWithPosition[] = [];

  const beforeComponents = flattenComponentsWithIndex(before);
  const afterComponents = flattenComponentsWithIndex(after);

  // Find removed, modified, reordered, and unchanged components
  for (const [key, { component, path, index: beforeIndex }] of beforeComponents) {
    const afterEntry = afterComponents.get(key);

    if (!afterEntry) {
      // Component was removed
      diffs.push({
        type: 'removed',
        componentId: component.props.id,
        componentType: component.type,
        path,
        before: component,
        beforeIndex,
        afterIndex: undefined,
      });
    } else {
      const isModified = !deepEqual(component, afterEntry.component);
      const isReordered = beforeIndex !== afterEntry.index;

      if (isModified) {
        // Component was modified (might also be reordered)
        diffs.push({
          type: 'modified',
          componentId: component.props.id,
          componentType: component.type,
          path,
          before: component,
          after: afterEntry.component,
          beforeIndex,
          afterIndex: afterEntry.index,
          reordered: isReordered,
        });
      } else if (isReordered) {
        // Component was only reordered
        diffs.push({
          type: 'reordered',
          componentId: component.props.id,
          componentType: component.type,
          path,
          before: component,
          after: afterEntry.component,
          beforeIndex,
          afterIndex: afterEntry.index,
        });
      } else {
        // Component is unchanged
        diffs.push({
          type: 'unchanged',
          componentId: component.props.id,
          componentType: component.type,
          path,
          before: component,
          after: afterEntry.component,
          beforeIndex,
          afterIndex: afterEntry.index,
        });
      }
    }
  }

  // Find added components
  for (const [key, { component, path, index: afterIndex }] of afterComponents) {
    if (!beforeComponents.has(key)) {
      diffs.push({
        type: 'added',
        componentId: component.props.id,
        componentType: component.type,
        path,
        after: component,
        beforeIndex: undefined,
        afterIndex,
      });
    }
  }

  return diffs;
}

/**
 * Compares two prop objects and returns detailed prop-level differences.
 *
 * @param before - Props before change
 * @param after - Props after change
 * @returns Array of prop differences
 */
export function diffProps(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): PropDiff[] {
  const diffs: PropDiff[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    // Skip the 'id' prop as it's an identifier, not content
    if (key === 'id') continue;

    const beforeValue = before[key];
    const afterValue = after[key];
    const beforeHas = key in before;
    const afterHas = key in after;

    if (!beforeHas && afterHas) {
      // Prop was added
      diffs.push({
        propName: key,
        type: 'added',
        before: undefined,
        after: afterValue,
      });
    } else if (beforeHas && !afterHas) {
      // Prop was removed
      diffs.push({
        propName: key,
        type: 'removed',
        before: beforeValue,
        after: undefined,
      });
    } else if (!deepEqual(beforeValue, afterValue)) {
      // Prop was modified
      diffs.push({
        propName: key,
        type: 'modified',
        before: beforeValue,
        after: afterValue,
      });
    }
  }

  return diffs;
}

/**
 * Filters diffs to only include reordered components.
 */
export function getReorderedComponents(
  diffs: ComponentDiffWithPosition[]
): ComponentDiffWithPosition[] {
  return diffs.filter(
    (diff) => diff.type === 'reordered' || (diff.reordered === true)
  );
}
