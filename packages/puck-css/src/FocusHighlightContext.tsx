/**
 * FocusHighlightContext
 *
 * Provides focus highlight state to components without requiring config recreation.
 * This context allows the focusMap to change without recreating Puck config,
 * which prevents flickering during collaborative editing.
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { FocusHighlight } from './utils/focusRegionMap.js';

/**
 * Context value for focus highlighting.
 */
export interface FocusHighlightContextValue {
  /** Map of component IDs to their focus highlight info */
  focusMap: Map<string, FocusHighlight>;
}

/**
 * Context for providing focus highlight state to wrapped components.
 */
export const FocusHighlightContext = createContext<FocusHighlightContextValue | null>(null);

/**
 * Props for FocusHighlightProvider.
 */
export interface FocusHighlightProviderProps {
  /** Map of component IDs to their focus highlight info */
  focusMap: Map<string, FocusHighlight>;
  /** Child components */
  children: React.ReactNode;
}

/**
 * Provider for focus highlight context.
 * Wrap your Puck editor with this to enable focus highlighting without config recreation.
 *
 * @example
 * ```tsx
 * const focusMap = createFocusRegionMap(data, otherActors);
 *
 * <FocusHighlightProvider focusMap={focusMap}>
 *   <Puck config={stableConfig} data={data} />
 * </FocusHighlightProvider>
 * ```
 */
export function FocusHighlightProvider({
  focusMap,
  children,
}: FocusHighlightProviderProps): React.ReactElement {
  const value = useMemo(() => ({ focusMap }), [focusMap]);

  return (
    <FocusHighlightContext.Provider value={value}>
      {children}
    </FocusHighlightContext.Provider>
  );
}

/**
 * Hook to access focus highlight context.
 * Returns null if not within a FocusHighlightProvider.
 */
export function useFocusHighlight(): FocusHighlightContextValue | null {
  return useContext(FocusHighlightContext);
}

/**
 * Hook to get focus highlight for a specific component ID.
 * Returns undefined if the component has no focus highlight.
 */
export function useFocusHighlightForComponent(id: string): FocusHighlight | undefined {
  const context = useFocusHighlight();
  return context?.focusMap.get(id);
}
