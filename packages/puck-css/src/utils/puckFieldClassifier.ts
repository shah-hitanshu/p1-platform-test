/**
 * Puck Field Classifier
 *
 * Puck-aware field classification for conflict resolution. Understands
 * the Puck component structure (content, zones, root) and classifies
 * individual prop changes as source-only, target-only, or conflicting
 * using optional three-way comparison with a base snapshot.
 */

import type { PuckData, PuckComponentData } from '@pantheon/css-client';

// =============================================================================
// Types
// =============================================================================

/**
 * Classification of a single field (prop) change across source and target.
 *
 * - `source-only`: Changed only in source (auto-mergeable from source)
 * - `target-only`: Changed only in target (auto-mergeable from target)
 * - `conflicting`: Changed in both source and target (requires resolution)
 */
export interface PuckFieldClassification {
  /** How this field change is classified. */
  classification: 'source-only' | 'target-only' | 'conflicting';

  /** Component ID (or 'root' for root props). */
  componentId: string;

  /** Component type name (or 'root' for root props). */
  componentType: string;

  /** The prop name that changed. */
  propName: string;

  /** Value of this prop in the source snapshot. */
  sourceValue: unknown;

  /** Value of this prop in the target snapshot. */
  targetValue: unknown;

  /** Location path, e.g. 'content', 'zones/sidebar', 'root'. */
  path: string;
}

/**
 * A group of field classifications for a single component,
 * with a flag indicating whether any true conflicts exist.
 */
export interface PuckComponentConflict {
  /** Component ID (or 'root'). */
  componentId: string;

  /** Component type name (or 'root'). */
  componentType: string;

  /** All classified fields for this component. */
  fields: PuckFieldClassification[];

  /** True if any field in this component is 'conflicting'. */
  hasConflicts: boolean;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Deeply compares two values for equality.
 *
 * Handles primitives, null, arrays, and plain objects. Uses the same
 * approach as diff.ts for consistency.
 *
 * @param a - First value
 * @param b - Second value
 * @returns True if the values are deeply equal
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;

  // Distinguish arrays from plain objects
  if (Array.isArray(a) !== Array.isArray(b)) return false;

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

/** Internal representation of a flattened component entry. */
interface FlattenedComponent {
  component: PuckComponentData;
  path: string;
}

/**
 * Flattens a PuckData structure into a map keyed by component ID.
 *
 * Walks content, then all zones, collecting each component with its
 * location path (e.g. 'content' or 'zones/sidebar').
 *
 * @param data - The PuckData to flatten
 * @returns Map from component ID to flattened entry
 */
function flattenComponentMap(data: PuckData): Map<string, FlattenedComponent> {
  const result = new Map<string, FlattenedComponent>();

  // Process main content
  const content = data?.content ?? [];
  for (const component of content) {
    result.set(component.props.id, { component, path: 'content' });
  }

  // Process zones
  if (data?.zones) {
    for (const [zoneName, components] of Object.entries(data.zones)) {
      for (const component of components ?? []) {
        result.set(component.props.id, {
          component,
          path: `zones/${zoneName}`,
        });
      }
    }
  }

  return result;
}

/**
 * Classifies props for a component that exists in both source and target.
 *
 * When a base snapshot is provided, uses three-way comparison:
 * - Changed in source only (base->source differs, base->target same) => 'source-only'
 * - Changed in target only (base->target differs, base->source same) => 'target-only'
 * - Changed in both => 'conflicting'
 *
 * When base is null, any differing prop is classified as 'conflicting'.
 * Props with identical values in source and target are skipped entirely.
 *
 * @param componentId - The component's ID
 * @param componentType - The component's type name
 * @param sourceProps - Props from the source snapshot
 * @param targetProps - Props from the target snapshot
 * @param baseProps - Props from the base snapshot (or null)
 * @param path - Location path (e.g. 'content', 'zones/sidebar', 'root')
 * @returns Array of field classifications
 */
function classifyComponentProps(
  componentId: string,
  componentType: string,
  sourceProps: Record<string, unknown>,
  targetProps: Record<string, unknown>,
  baseProps: Record<string, unknown> | null,
  path: string
): PuckFieldClassification[] {
  const fields: PuckFieldClassification[] = [];
  const allKeys = new Set([...Object.keys(sourceProps), ...Object.keys(targetProps)]);

  for (const key of allKeys) {
    // Skip the 'id' prop — it's an identifier, not content
    if (key === 'id') continue;

    const sourceValue = sourceProps[key];
    const targetValue = targetProps[key];

    // If source and target are the same, no change to classify
    if (deepEqual(sourceValue, targetValue)) continue;

    if (baseProps !== null) {
      // Three-way comparison
      const baseValue = baseProps[key];
      const sourceChanged = !deepEqual(baseValue, sourceValue);
      const targetChanged = !deepEqual(baseValue, targetValue);

      if (sourceChanged && targetChanged) {
        fields.push({
          classification: 'conflicting',
          componentId,
          componentType,
          propName: key,
          sourceValue,
          targetValue,
          path,
        });
      } else if (sourceChanged) {
        fields.push({
          classification: 'source-only',
          componentId,
          componentType,
          propName: key,
          sourceValue,
          targetValue,
          path,
        });
      } else if (targetChanged) {
        fields.push({
          classification: 'target-only',
          componentId,
          componentType,
          propName: key,
          sourceValue,
          targetValue,
          path,
        });
      }
    } else {
      // No base — any difference is a conflict
      fields.push({
        classification: 'conflicting',
        componentId,
        componentType,
        propName: key,
        sourceValue,
        targetValue,
        path,
      });
    }
  }

  return fields;
}

/**
 * Emits field classifications for all props of a component that exists
 * in only one side (source or target).
 *
 * @param componentId - The component's ID
 * @param componentType - The component's type name
 * @param props - The component's props
 * @param classification - 'source-only' or 'target-only'
 * @param path - Location path
 * @returns Array of field classifications
 */
function classifyExclusiveComponent(
  componentId: string,
  componentType: string,
  props: Record<string, unknown>,
  classification: 'source-only' | 'target-only',
  path: string
): PuckFieldClassification[] {
  const fields: PuckFieldClassification[] = [];

  for (const key of Object.keys(props)) {
    // Skip the 'id' prop
    if (key === 'id') continue;

    fields.push({
      classification,
      componentId,
      componentType,
      propName: key,
      sourceValue: classification === 'source-only' ? props[key] : undefined,
      targetValue: classification === 'target-only' ? props[key] : undefined,
      path,
    });
  }

  return fields;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Detects whether the given data looks like a PuckData structure.
 *
 * Checks for the presence of a `content` array and a `root` object,
 * which are the defining characteristics of Puck page data.
 *
 * @param data - The data to check
 * @returns True if the data has the shape of PuckData
 *
 * @example
 * ```typescript
 * if (isPuckData(snapshot)) {
 *   const fields = classifyPuckFields(source, target, base);
 * }
 * ```
 */
export function isPuckData(data: unknown): boolean {
  if (data === null || data === undefined || typeof data !== 'object') {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.content)) {
    return false;
  }

  if (obj.root === null || obj.root === undefined || typeof obj.root !== 'object') {
    return false;
  }

  return true;
}

/**
 * Classifies all fields across source and target PuckData snapshots.
 *
 * Walks content components, zone components, and root props, producing
 * a classification for each prop that differs. When a base snapshot is
 * provided, uses three-way comparison to distinguish source-only and
 * target-only changes from true conflicts.
 *
 * @param source - The source PuckData snapshot
 * @param target - The target PuckData snapshot
 * @param base - The common ancestor snapshot, or null for two-way comparison
 * @returns Array of field classifications across all components
 *
 * @example
 * ```typescript
 * const fields = classifyPuckFields(sourceBranch, targetBranch, commonAncestor);
 * const conflicts = fields.filter(f => f.classification === 'conflicting');
 * ```
 */
export function classifyPuckFields(
  source: PuckData,
  target: PuckData,
  base: PuckData | null
): PuckFieldClassification[] {
  const fields: PuckFieldClassification[] = [];

  // Flatten source and target into component maps
  const sourceMap = flattenComponentMap(source);
  const targetMap = flattenComponentMap(target);

  // Build base map if available
  const baseMap = base ? flattenComponentMap(base) : null;

  // Process components only in source → source-only
  for (const [id, { component, path }] of sourceMap) {
    if (!targetMap.has(id)) {
      fields.push(
        ...classifyExclusiveComponent(id, component.type, component.props, 'source-only', path)
      );
    }
  }

  // Process components only in target → target-only
  for (const [id, { component, path }] of targetMap) {
    if (!sourceMap.has(id)) {
      fields.push(
        ...classifyExclusiveComponent(id, component.type, component.props, 'target-only', path)
      );
    }
  }

  // Process components in both → compare props
  for (const [id, { component: sourceComponent, path }] of sourceMap) {
    const targetEntry = targetMap.get(id);
    if (!targetEntry) continue;

    const baseEntry = baseMap?.get(id) ?? null;
    const baseProps = baseEntry ? baseEntry.component.props : null;

    fields.push(
      ...classifyComponentProps(
        id,
        sourceComponent.type,
        sourceComponent.props,
        targetEntry.component.props,
        baseProps,
        path
      )
    );
  }

  // Process root props
  const sourceRootProps = source.root?.props ?? {};
  const targetRootProps = target.root?.props ?? {};
  const baseRootProps = base?.root?.props ?? null;

  fields.push(
    ...classifyComponentProps(
      'root',
      'root',
      sourceRootProps,
      targetRootProps,
      baseRootProps ?? null,
      'root'
    )
  );

  return fields;
}

/**
 * Returns a human-readable path description for a prop change.
 *
 * Formats the path with arrow separators for easy reading in UIs:
 * - Content components: "Heading -> text"
 * - Zone components: "sidebar -> Widget -> label"
 * - Root props: "Page -> title"
 *
 * @param path - Location path (e.g. 'content', 'zones/sidebar', 'root')
 * @param componentType - The component type name
 * @param propName - The prop name
 * @returns Human-readable string like "Heading -> text"
 *
 * @example
 * ```typescript
 * getReadablePropPath('content', 'Heading', 'text');
 * // => 'Heading \u2192 text'
 *
 * getReadablePropPath('zones/sidebar', 'Widget', 'label');
 * // => 'sidebar \u2192 Widget \u2192 label'
 *
 * getReadablePropPath('root', 'root', 'title');
 * // => 'Page \u2192 title'
 * ```
 */
export function getReadablePropPath(
  path: string,
  componentType: string,
  propName: string
): string {
  if (path === 'root') {
    return `Page \u2192 ${propName}`;
  }

  if (path.startsWith('zones/')) {
    const zoneName = path.slice('zones/'.length);
    return `${zoneName} \u2192 ${componentType} \u2192 ${propName}`;
  }

  // Default: content path
  return `${componentType} \u2192 ${propName}`;
}

/**
 * Groups an array of field classifications by component ID.
 *
 * Produces one `PuckComponentConflict` per unique component, collecting
 * all its fields and determining whether any of them are true conflicts.
 *
 * @param fields - Array of field classifications to group
 * @returns Array of component conflict groups
 *
 * @example
 * ```typescript
 * const fields = classifyPuckFields(source, target, base);
 * const groups = groupFieldsByComponent(fields);
 * for (const group of groups) {
 *   if (group.hasConflicts) {
 *     console.log(`Conflicts in ${group.componentType}`);
 *   }
 * }
 * ```
 */
export function groupFieldsByComponent(
  fields: PuckFieldClassification[]
): PuckComponentConflict[] {
  const groupMap = new Map<string, PuckComponentConflict>();

  for (const field of fields) {
    let group = groupMap.get(field.componentId);

    if (!group) {
      group = {
        componentId: field.componentId,
        componentType: field.componentType,
        fields: [],
        hasConflicts: false,
      };
      groupMap.set(field.componentId, group);
    }

    group.fields.push(field);

    if (field.classification === 'conflicting') {
      group.hasConflicts = true;
    }
  }

  return Array.from(groupMap.values());
}

/**
 * Tracks resolution choices keyed by "componentId:propName".
 */
export type ResolutionMap = Record<string, 'source' | 'target'>;

/**
 * Constructs a merged PuckData snapshot from resolution choices.
 *
 * Strategy:
 * - Start with a deep clone of the target snapshot as the base
 * - Apply source-only changes (overwrite with source values)
 * - Keep target-only changes (already in target clone)
 * - Apply user conflict resolutions (source or target)
 *
 * @param source - The source PuckData snapshot
 * @param target - The target PuckData snapshot
 * @param fields - Classified fields from classifyPuckFields
 * @param resolutions - Map of "componentId:propName" to 'source' | 'target'
 * @returns Merged PuckData snapshot
 */
export function buildMergedSnapshot(
  source: PuckData,
  target: PuckData,
  fields: PuckFieldClassification[],
  resolutions: ResolutionMap
): PuckData {
  // Deep clone target as starting point
  const merged: PuckData = JSON.parse(JSON.stringify(target));

  // Build lookup maps for source components
  const sourceContentMap = new Map<string, PuckComponentData>();
  for (const comp of source.content) {
    sourceContentMap.set(comp.props.id, comp);
  }

  // Build lookup maps for merged (target-based) components
  const mergedContentMap = new Map<string, PuckComponentData>();
  for (const comp of merged.content) {
    mergedContentMap.set(comp.props.id, comp);
  }

  // Apply field resolutions
  for (const field of fields) {
    const key = `${field.componentId}:${field.propName}`;
    let useSource = false;

    if (field.classification === 'source-only') {
      // Auto-merge: take source value
      useSource = true;
    } else if (field.classification === 'target-only') {
      // Auto-merge: keep target value (already in merged)
      useSource = false;
    } else if (field.classification === 'conflicting') {
      // Use user's resolution
      useSource = resolutions[key] === 'source';
    }

    if (field.componentId === 'root') {
      // Apply to root props
      if (useSource) {
        if (!merged.root.props) {
          merged.root.props = {};
        }
        merged.root.props[field.propName] = JSON.parse(
          JSON.stringify(field.sourceValue)
        );
      }
    } else if (field.path.startsWith('zones/')) {
      // Apply to zone component
      const zoneName = field.path.slice('zones/'.length);
      const zoneComponents = merged.zones?.[zoneName];
      if (zoneComponents) {
        const comp = zoneComponents.find(
          (c) => c.props.id === field.componentId
        );
        if (comp && useSource) {
          comp.props[field.propName] = JSON.parse(
            JSON.stringify(field.sourceValue)
          );
        }
      }
    } else {
      // Apply to content component
      const comp = mergedContentMap.get(field.componentId);
      if (comp && useSource) {
        comp.props[field.propName] = JSON.parse(
          JSON.stringify(field.sourceValue)
        );
      }
    }
  }

  return merged;
}
