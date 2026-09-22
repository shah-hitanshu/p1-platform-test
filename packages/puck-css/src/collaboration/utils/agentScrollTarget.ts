import type { FocusHighlight } from './focusRegionMap.js';

/**
 * The agent-held block nearest the top of the page, in document order rather
 * than the order the agent named its regions.
 */
export function agentScrollTarget(
  doc: Document,
  focusMap: Map<string, FocusHighlight>,
): HTMLElement | null {
  const agentBlocks = new Set(
    [...focusMap.entries()]
      .filter(([, highlight]) => highlight.isAgent === true && highlight.isEditing)
      .map(([componentId]) => componentId),
  );

  if (agentBlocks.size === 0) {
    return null;
  }

  const drawn = doc.querySelectorAll<HTMLElement>('[data-puck-component]');
  for (const el of drawn) {
    const componentId = el.getAttribute('data-puck-component');
    if (componentId !== null && agentBlocks.has(componentId)) {
      return el;
    }
  }

  return null;
}
