/**
 * P1 Puck Context
 *
 * React context for sharing P1 state across Puck components.
 */

import { createContext, useContext } from 'react';
import type { P1PuckContextValue } from './types.js';

/**
 * Context for P1 Puck integration state.
 */
export const P1PuckContext = createContext<P1PuckContextValue | null>(null);

/**
 * Hook to access P1 Puck context.
 *
 * @throws Error if used outside of P1PuckProvider
 * @returns P1 Puck context value
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { saveStatus, createCheckpoint } = useP1Puck();
 *
 *   return (
 *     <button onClick={() => createCheckpoint('Publish')}>
 *       {saveStatus === 'saving' ? 'Saving...' : 'Publish'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useP1Puck(): P1PuckContextValue {
  const context = useContext(P1PuckContext);

  if (context === null) {
    throw new Error('useP1Puck must be used within a P1PuckProvider');
  }

  return context;
}

/**
 * Non-throwing variant of useP1Puck.
 * Returns null when no P1PuckProvider is present instead of throwing.
 */
export function useP1PuckOptional(): P1PuckContextValue | null {
  return useContext(P1PuckContext);
}
