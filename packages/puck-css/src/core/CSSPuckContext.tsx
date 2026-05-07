/**
 * CSS Puck Context
 *
 * React context for sharing CSS state across Puck components.
 */

import { createContext, useContext } from 'react';
import type { CSSPuckContextValue } from './types.js';

/**
 * Context for CSS Puck integration state.
 */
export const CSSPuckContext = createContext<CSSPuckContextValue | null>(null);

/**
 * Hook to access CSS Puck context.
 *
 * @throws Error if used outside of CSSPuckProvider
 * @returns CSS Puck context value
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { saveStatus, createCheckpoint } = useCSSPuck();
 *
 *   return (
 *     <button onClick={() => createCheckpoint('Publish')}>
 *       {saveStatus === 'saving' ? 'Saving...' : 'Publish'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useCSSPuck(): CSSPuckContextValue {
  const context = useContext(CSSPuckContext);

  if (context === null) {
    throw new Error('useCSSPuck must be used within a CSSPuckProvider');
  }

  return context;
}

/**
 * Non-throwing variant of useCSSPuck.
 * Returns null when no CSSPuckProvider is present instead of throwing.
 */
export function useCSSPuckOptional(): CSSPuckContextValue | null {
  return useContext(CSSPuckContext);
}
