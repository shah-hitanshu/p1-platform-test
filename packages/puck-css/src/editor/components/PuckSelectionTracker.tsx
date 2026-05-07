/**
 * PuckSelectionTracker
 *
 * A component that watches Puck's selection state and reports changes.
 * Must be rendered inside the Puck component tree to access the usePuck hook.
 *
 * This component enables proactive focus region reporting by converting
 * Puck's internal selection format to JSON paths that the backend understands.
 */

import { useEffect, useRef } from 'react';
import { createUsePuck } from '@puckeditor/core';

// Create a usePuck hook with selector to watch selection state
const usePuckSelection = createUsePuck();

export interface PuckSelectionTrackerProps {
  /**
   * Callback when selection changes.
   * @param path - JSON path of the selected item (e.g., "/content/0"), or null if deselected
   * @param itemId - The component's ID, or null if deselected
   */
  onSelectionChange: (path: string | null, itemId: string | null) => void;
}

/**
 * Convert Puck's zone/index selector to a JSON path that matches
 * the document structure.
 *
 * Puck's itemSelector format:
 * - Root zone: { zone: "root:default-zone", index: N } → data.content[N]
 * - Nested zone: { zone: "{componentId}:{zoneName}", index: M } → data.zones[...][M]
 *
 * We convert to document paths that the backend can use for conflict detection:
 * - Root zone → "/content/{index}"
 * - Nested zone → "/zones/{componentId}:{zoneName}/{index}"
 */
function selectorToPath(zone: string, index: number): string {
  // Root zone: "root:default-zone" maps to data.content array
  if (zone === 'root:default-zone') {
    return `/content/${index}`;
  }

  // Legacy format: "content" also maps to data.content array
  if (zone === 'content') {
    return `/content/${index}`;
  }

  // Nested zones: "{componentId}:{zoneName}" format
  // These map to data.zones["{componentId}:{zoneName}"]
  // We preserve the zone compound as-is for conflict detection
  return `/zones/${zone}/${index}`;
}

/**
 * Watches Puck's selection state and calls onSelectionChange when it changes.
 *
 * This component renders nothing but uses Puck's internal state to track
 * which component the user has selected. The path is formatted to match
 * the JSON path format used by the backend for region conflict detection.
 *
 * @example
 * ```tsx
 * function PuckWithTracking() {
 *   const { setFocusRegions, clearFocus } = useFocusRegionReporting();
 *
 *   const handleSelectionChange = (path, itemId) => {
 *     if (path) {
 *       setFocusRegions([path]);
 *     } else {
 *       clearFocus();
 *     }
 *   };
 *
 *   return (
 *     <Puck {...config}>
 *       <PuckSelectionTracker onSelectionChange={handleSelectionChange} />
 *     </Puck>
 *   );
 * }
 * ```
 */
export function PuckSelectionTracker({
  onSelectionChange,
}: PuckSelectionTrackerProps): null {
  // Track previous values to detect changes (use undefined to distinguish from null)
  const prevPathRef = useRef<string | null | undefined>(undefined);
  const prevItemIdRef = useRef<string | null | undefined>(undefined);

  // Use selector to get just the parts we need
  const itemSelector = usePuckSelection((state) => state.appState.ui.itemSelector);
  const selectedItem = usePuckSelection((state) => state.selectedItem);

  // Convert to path and itemId
  // Only create path if itemSelector has required fields (zone and index)
  const path = itemSelector && itemSelector.zone !== undefined && itemSelector.index !== undefined
    ? selectorToPath(itemSelector.zone, itemSelector.index)
    : null;
  const itemId = selectedItem?.props?.id ?? null;

  // Call onSelectionChange when values change (or on initial render)
  useEffect(() => {
    // Use undefined as initial state to ensure we call on first render
    if (prevPathRef.current === undefined || path !== prevPathRef.current || itemId !== prevItemIdRef.current) {
      prevPathRef.current = path;
      prevItemIdRef.current = itemId;
      onSelectionChange(path, itemId);
    }
  }, [path, itemId, onSelectionChange]);

  // This component renders nothing
  return null;
}
