import type { FocusHighlight } from './focusRegionMap.js';

const HIGHLIGHT_CLASS = 'focus-region-highlight';
const EDITING_CLASS = 'focus-region-highlight--editing';

// IDs are UUIDs or ULIDs, so they need no escaping.
function componentElement(doc: Document, componentId: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-puck-component="${componentId}"]`);
}

function clearHighlight(el: HTMLElement): void {
  el.classList.remove(HIGHLIGHT_CLASS, EDITING_CLASS);
  el.style.removeProperty('--focus-color');
  el.removeAttribute('data-focus-actor');
  el.removeAttribute('data-focus-initial');
  el.removeAttribute('data-focus-role');
}

/**
 * Writes the map's highlights onto the canvas and clears those that left it,
 * returning the IDs to pass back as `previous`. Only classes, properties and
 * attributes are written: inserting an element can make the browser scroll.
 */
export function applyFocusHighlights(
  doc: Document,
  focusMap: Map<string, FocusHighlight>,
  previous: ReadonlySet<string>,
): Set<string> {
  previous.forEach((componentId) => {
    if (focusMap.has(componentId)) {
      return;
    }
    const el = componentElement(doc, componentId);
    if (el) {
      clearHighlight(el);
    }
  });

  const current = new Set<string>();

  focusMap.forEach((highlight, componentId) => {
    // Recorded even when not drawn, so it is cleared once it leaves the map.
    current.add(componentId);

    const el = componentElement(doc, componentId);
    if (!el) {
      return;
    }

    el.classList.add(HIGHLIGHT_CLASS);
    el.classList.toggle(EDITING_CLASS, highlight.isEditing);
    el.style.setProperty('--focus-color', highlight.color);
    el.setAttribute('data-focus-actor', highlight.actorId);
    el.setAttribute('data-focus-initial', highlight.actorName.charAt(0).toUpperCase());

    // What the stylesheet keys an agent's marking on.
    if (highlight.isAgent === true) {
      el.setAttribute('data-focus-role', 'agent');
    } else {
      el.removeAttribute('data-focus-role');
    }
  });

  return current;
}
