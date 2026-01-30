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
 * Convert Puck's zone/index selector to a JSON path.
 *
 * Puck uses format: { zone: "content" | "zones:Header:left", index: 0 }
 * We convert to: "/content/0" or "/zones/Header/left/0"
 */
function selectorToPath(zone: string, index: number): string {
  // Handle zone format: "content" or "zones:Parent:zone"
  if (zone === 'content') {
    return `/content/${index}`;
  }

  // Convert "zones:Header:left" to "/zones/Header/left/index"
  const parts = zone.split(':');
  return `/${parts.join('/')}/${index}`;
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
