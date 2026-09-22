import { useMemo } from 'react';
import { useP1PuckOptional } from '../core/P1PuckContext.js';
import { useOptionalPresenceContext } from '../core/PresenceContext.js';
import { createFocusRegionMap } from './utils/focusRegionMap.js';

/**
 * The blocks an agent holds, read from the same presence as the canvas marking
 * so the two cannot disagree. Held counts whether or not the agent is writing.
 */
export function useAgentHeldBlocks(): Set<string> {
  const ccr = useP1PuckOptional();
  const presenceCtx = useOptionalPresenceContext();
  const data = ccr?.safeData;

  return useMemo(() => {
    const held = new Set<string>();
    if (data === undefined || presenceCtx === null) {
      return held;
    }
    const others = presenceCtx.actors.filter((a) => a.actorId !== presenceCtx.userId);
    const map = createFocusRegionMap(data, others);
    map.forEach((highlight, componentId) => {
      if (highlight.isAgent === true) {
        held.add(componentId);
      }
    });
    return held;
  }, [data, presenceCtx]);
}
