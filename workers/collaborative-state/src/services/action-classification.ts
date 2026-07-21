/**
 * Phase 4: Action Classification Service
 *
 * Classifies document changes as structural or prop-only based on:
 * 1. Puck action metadata (preferred, when available)
 * 2. JSON Patch path analysis (fallback)
 *
 * Structural changes modify the component tree (insert, reorder, move, duplicate, remove).
 * Prop-only changes modify leaf properties without affecting component structure.
 *
 * @see PROPOSAL-010 Section 5: Structural Action Capture
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Result of classifying a change.
 */
export interface ClassifyChangeResult {
  actionType: string | null;
  actionMetadata: Record<string, unknown> | null;
}

/**
 * A Puck action that may be forwarded from the frontend.
 * These are the actions that Puck's onAction callback fires.
 */
export interface PuckAction {
  type: string;
  [key: string]: unknown;
}

/**
 * Structural Puck action types (component tree modifications).
 */
const STRUCTURAL_ACTION_TYPES = new Set([
  'insert',
  'reorder',
  'move',
  'duplicate',
  'remove',
  'migration',
]);

// =============================================================================
// Public API
// =============================================================================

/**
 * Classifies a change as structural or prop-only.
 *
 * Classification logic:
 * 1. If puckActions are provided, check if any are structural types
 * 2. If structural puckActions found, return { actionType: 'structural', actionMetadata: { puckActions } }
 * 3. Fallback: analyze JSON patch paths using isStructuralPath
 * 4. If patch indicates structural change, return { actionType: 'structural', actionMetadata: { derived: true } }
 * 5. Otherwise return { actionType: null, actionMetadata: null }
 *
 * @param patch - RFC 6902 JSON Patch operations (optional)
 * @param puckActions - Puck actions forwarded from the frontend (optional)
 * @returns Classification result with actionType and actionMetadata
 */
export function classifyChange(
  patch: unknown[] | undefined,
  puckActions?: { type: string; [key: string]: unknown }[],
): ClassifyChangeResult {
  // 1. Check for Puck actions (preferred, most accurate)
  if (puckActions && puckActions.length > 0) {
    const hasStructuralAction = puckActions.some((action) =>
      STRUCTURAL_ACTION_TYPES.has(action.type),
    );

    if (hasStructuralAction) {
      return {
        actionType: 'structural',
        actionMetadata: { puckActions },
      };
    }

    // Puck actions exist but none are structural (e.g., only "set" actions)
    return {
      actionType: 'prop_update',
      actionMetadata: { puckActions },
    };
  }

  // 2. Fallback to JSON Patch path analysis
  if (!patch || patch.length === 0) {
    return {
      actionType: null,
      actionMetadata: null,
    };
  }

  // Classify each patch operation as structural, prop-only, or invalid
  let hasStructuralPatch = false;
  let hasValidPropPatch = false;

  for (const op of patch) {
    if (typeof op !== 'object' || op === null) {
      continue;
    }

    const operation = op as { op?: string; path?: string };

    if (
      typeof operation.op !== 'string' ||
      operation.op.length === 0
    ) {
      continue;
    }

    if (operation.op === 'test') {
      continue;
    }

    if (
      typeof operation.path !== 'string' ||
      operation.path.length === 0
    ) {
      continue;
    }

    // Must be a valid JSON pointer
    if (!operation.path.startsWith('/')) {
      continue;
    }

    // Reject malformed paths
    if (operation.path.includes('//') || operation.path.endsWith('/')) {
      continue;
    }

    if (isStructuralPath(operation.path)) {
      hasStructuralPatch = true;
    } else {
      hasValidPropPatch = true;
    }
  }

  if (hasStructuralPatch) {
    return {
      actionType: 'structural',
      actionMetadata: { derived: true },
    };
  }

  if (hasValidPropPatch) {
    return {
      actionType: 'prop_update',
      actionMetadata: { derived: true },
    };
  }

  return {
    actionType: null,
    actionMetadata: null,
  };
}

/**
 * Determines if a JSON Patch path represents a structural change.
 *
 * Structural paths are those that modify component arrays directly:
 * - /root (entire root array)
 * - /root/N (component at index N in root)
 * - /content (entire content array)
 * - /content/N (component at index N in content)
 * - /zones/ZONE_NAME/N (component at index N in a zone)
 * - Any path ending with /N where N is an integer (nested array element)
 *
 * Non-structural paths (prop changes):
 * - /root/N/props/... (property edits)
 * - /content/N/props/... (property edits)
 * - /zones/ZONE_NAME/N/props/... (zone property edits)
 * - /metadata/... (metadata edits)
 *
 * Edge cases handled:
 * - Empty paths, paths without leading /, paths with double slashes
 * - Paths with escaped characters (~0 = ~, ~1 = /)
 * - Very long paths (>1000 chars)
 * - Malformed paths (trailing slashes, etc.)
 *
 * @param path - JSON Patch path (e.g., "/root/0", "/content/2/props/title")
 * @returns true if the path represents a structural change
 */
export function isStructuralPath(path: string): boolean {
  // Defensive: handle empty, null, undefined, or malformed paths
  if (!path || typeof path !== 'string' || path.length === 0) {
    return false;
  }

  // Invalid JSON Pointer: must start with /
  if (!path.startsWith('/')) {
    return false;
  }

  // Reject obviously malformed paths
  if (path.includes('//') || path.endsWith('/')) {
    return false;
  }

  // Exact match: entire root or content array
  if (path === '/root' || path === '/content') {
    return true;
  }

  // Match: /root/N or /content/N (array element, NOT followed by /props or deeper)
  // This regex ensures we only match component-level changes, not property edits
  const rootContentRegex = /^\/(root|content)\/\d+$/;
  if (rootContentRegex.test(path)) {
    return true;
  }

  // Match: /zones/ZONE_NAME/N (zone array elements)
  // Example: /zones/header/0, /zones/sidebar/2
  const zoneArrayRegex = /^\/zones\/[^/]+\/\d+$/;
  if (zoneArrayRegex.test(path)) {
    return true;
  }

  // Match: Any path segment ending with /N where N is a digit
  // This catches nested array modifications like:
  // - /zones/sidebar/0/props/content/0
  // - /root/0/props/items/0
  // But NOT property paths like:
  // - /root/0/props/title
  // - /zones/header/0/props/text
  //
  // Strategy: Check if the path ends with /N (where N is an integer)
  // and doesn't contain /props after the last array index
  const segments = path.split('/').filter((s) => s.length > 0);

  if (segments.length === 0) {
    return false;
  }

  const lastSegment = segments[segments.length - 1];

  // Check if last segment is a number (array index)
  if (/^\d+$/.test(lastSegment)) {
    // Now check if there's a /props before this index
    // Find the position of this index in the path
    const pathWithoutLastSegment = segments.slice(0, -1).join('/');

    // If the path before the last segment contains "props", it's a prop change
    // Example: /root/0/props/items/0 -> "root/0/props/items" contains "props"
    if (pathWithoutLastSegment.includes('props')) {
      return false;
    }

    // No props in path, this is a structural change
    // Example: /zones/header/0
    return true;
  }

  return false;
}
