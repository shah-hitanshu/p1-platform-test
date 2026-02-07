/**
 * Transform Diff Operations
 *
 * Transforms RFC 6902 DiffOperation[] + source/target snapshots into
 * grouped ContentSection[] for human-readable display.
 *
 * Detects Puck data structures heuristically and groups changes by component.
 * Falls back to top-level key grouping for generic JSON.
 */

import type { DiffOperation } from '../../types';
import type { ContentChange, ContentSection } from './types';

/**
 * Heuristically detect Puck editor data structure.
 * Checks for `content` array with `{type, props: {id}}` pattern + `root` object.
 */
export function isPuckData(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.content)) return false;
  if (obj.content.length === 0) return typeof obj.root === 'object' && obj.root !== null;

  // Check first element has type and props with id
  const first = obj.content[0];
  if (typeof first !== 'object' || first === null) return false;
  const firstObj = first as Record<string, unknown>;
  if (typeof firstObj.type !== 'string') return false;
  if (typeof firstObj.props !== 'object' || firstObj.props === null) return false;

  return true;
}

/**
 * Generate a human-readable label from a JSON Pointer path segment.
 * Converts camelCase and snake_case to Title Case.
 */
export function generateFieldLabel(path: string): string {
  // Get the last meaningful segment (skip array indices)
  const segments = path.split('/').filter(Boolean);
  let lastSegment = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!/^\d+$/.test(segments[i])) {
      lastSegment = segments[i];
      break;
    }
  }

  if (!lastSegment) return path;

  // Convert camelCase to spaces
  let label = lastSegment.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Convert snake_case to spaces
  label = label.replace(/_/g, ' ');
  // Title case
  label = label
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return label;
}

/**
 * Resolve a JSON Pointer path to a value in an object.
 */
function resolvePathValue(data: unknown, path: string): unknown {
  if (data === null || data === undefined) return undefined;
  const segments = path.split('/').filter(Boolean);
  let current: unknown = data;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    const obj = current as Record<string, unknown>;
    const index = /^\d+$/.test(segment) ? Number(segment) : segment;
    current = Array.isArray(obj) ? (obj as unknown[])[index as number] : obj[segment];
  }
  return current;
}

/**
 * Get the Puck component info from a content path.
 * e.g. /content/0/props/text -> { index: 0, propPath: 'text' }
 */
function parsePuckContentPath(path: string): { index: number; propPath: string } | null {
  const match = path.match(/^\/content\/(\d+)\/props\/(.+)$/);
  if (!match) return null;
  return { index: Number(match[1]), propPath: match[2] };
}

/**
 * Get the Puck root path info.
 * e.g. /root/props/title -> { propPath: 'title' }
 */
function parsePuckRootPath(path: string): { propPath: string } | null {
  const match = path.match(/^\/root\/props\/(.+)$/);
  if (!match) return null;
  return { propPath: match[1] };
}

/**
 * Get the top-level key from a path for non-Puck grouping.
 */
function getTopLevelKey(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[0] ?? '';
}

/**
 * Transform diff operations into grouped content sections.
 */
export function transformDiffOperations(
  sourceData: Record<string, unknown> | null,
  targetData: Record<string, unknown> | null,
  operations: DiffOperation[]
): ContentSection[] {
  if (operations.length === 0) return [];

  const effectiveSource = sourceData ?? {};
  const effectiveTarget = targetData ?? {};
  const usePuck = isPuckData(effectiveSource) || isPuckData(effectiveTarget);

  if (usePuck) {
    return groupByPuckComponent(effectiveSource, effectiveTarget, operations);
  }

  return groupByTopLevelKey(effectiveSource, effectiveTarget, operations);
}

/**
 * Group changes by Puck component.
 */
function groupByPuckComponent(
  sourceData: Record<string, unknown>,
  targetData: Record<string, unknown>,
  operations: DiffOperation[]
): ContentSection[] {
  const componentSections = new Map<string, ContentSection>();
  let rootSection: ContentSection | null = null;
  const ungrouped: ContentChange[] = [];

  const sourceContent = (sourceData.content ?? []) as Array<Record<string, unknown>>;
  const targetContent = (targetData.content ?? []) as Array<Record<string, unknown>>;

  for (const op of operations) {
    const contentParsed = parsePuckContentPath(op.path);
    if (contentParsed) {
      const { index, propPath } = contentParsed;
      // Use source or target to determine the component type
      const component =
        (sourceContent[index] as Record<string, unknown> | undefined) ??
        (targetContent[index] as Record<string, unknown> | undefined);
      const componentType = (component?.type as string) ?? `Component ${index}`;
      const key = `content-${index}`;

      if (!componentSections.has(key)) {
        componentSections.set(key, {
          label: `${componentType}`,
          componentType,
          componentIndex: index,
          changes: [],
        });
      }

      const change: ContentChange = {
        type: op.op,
        path: op.path,
        label: generateFieldLabel(`/${propPath}`),
        oldValue: resolvePathValue(sourceData, op.path),
        newValue: op.op === 'remove' ? undefined : op.value ?? resolvePathValue(targetData, op.path),
      };

      componentSections.get(key)!.changes.push(change);
      continue;
    }

    const rootParsed = parsePuckRootPath(op.path);
    if (rootParsed) {
      if (!rootSection) {
        rootSection = {
          label: 'Page Settings',
          changes: [],
        };
      }

      const change: ContentChange = {
        type: op.op,
        path: op.path,
        label: generateFieldLabel(`/${rootParsed.propPath}`),
        oldValue: resolvePathValue(sourceData, op.path),
        newValue: op.op === 'remove' ? undefined : op.value ?? resolvePathValue(targetData, op.path),
      };

      rootSection.changes.push(change);
      continue;
    }

    // Ungrouped Puck changes (e.g. content array level changes)
    ungrouped.push({
      type: op.op,
      path: op.path,
      label: generateFieldLabel(op.path),
      oldValue: resolvePathValue(sourceData, op.path),
      newValue: op.op === 'remove' ? undefined : op.value ?? resolvePathValue(targetData, op.path),
    });
  }

  const sections: ContentSection[] = [];

  if (rootSection) {
    sections.push(rootSection);
  }

  // Sort component sections by index
  const sortedComponents = Array.from(componentSections.values()).sort(
    (a, b) => (a.componentIndex ?? 0) - (b.componentIndex ?? 0)
  );
  sections.push(...sortedComponents);

  if (ungrouped.length > 0) {
    sections.push({
      label: 'Other Changes',
      changes: ungrouped,
    });
  }

  return sections;
}

/**
 * Group changes by top-level JSON key.
 */
function groupByTopLevelKey(
  sourceData: Record<string, unknown>,
  targetData: Record<string, unknown>,
  operations: DiffOperation[]
): ContentSection[] {
  const sectionMap = new Map<string, ContentSection>();

  for (const op of operations) {
    const topKey = getTopLevelKey(op.path);
    const sectionLabel = generateFieldLabel(`/${topKey}`);

    if (!sectionMap.has(topKey)) {
      sectionMap.set(topKey, {
        label: sectionLabel,
        changes: [],
      });
    }

    const change: ContentChange = {
      type: op.op,
      path: op.path,
      label: generateFieldLabel(op.path),
      oldValue: resolvePathValue(sourceData, op.path),
      newValue: op.op === 'remove' ? undefined : op.value ?? resolvePathValue(targetData, op.path),
    };

    sectionMap.get(topKey)!.changes.push(change);
  }

  return Array.from(sectionMap.values());
}
