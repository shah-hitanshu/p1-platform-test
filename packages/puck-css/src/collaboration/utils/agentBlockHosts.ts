/**
 * Mount points for the agent overlay: one per run of neighbouring blocks an
 * agent holds, drawn inside the page, plus a marker in the editor's gutter for a
 * run at the very top of the page.
 */

import type { FocusHighlight } from './focusRegionMap.js';

const HOST_CLASS = 'focus-region-agent-host';
const LAYER_CLASS = 'focus-region-agent-layer';
const BLOCK_ATTR = 'data-agent-block';
const GUTTER_ATTR = 'data-gutter';
const GUTTER_MARKER_ATTR = 'data-gutter-marker';
const TEST_ID_ATTR = 'data-testid';
const HOST_TEST_ID = 'agent-block-overlay';
const GUTTER_MARKER_TEST_ID = 'agent-block-gutter-marker';

/** The component IDs a run's key covers, in page order. */
export function agentRunBlocks(runKey: string): string[] {
  return runKey.split(' ');
}

/**
 * Half the badge: a 32px disc, a 2px keyline and a 2px ring. Keep it below the
 * gutter PuckEditorTheme.css holds open.
 */
const MARKER_OVERHANG = 20;

/** Must match `--agent-fade` in styles.css. */
export const AGENT_FADE_MS = 300;

const LEAVING_ATTR = 'data-leaving';

const fadeTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function startFade(host: HTMLElement): void {
  if (fadeTimers.has(host)) {
    return;
  }
  host.setAttribute(LEAVING_ATTR, '');
  fadeTimers.set(
    host,
    setTimeout(() => {
      fadeTimers.delete(host);
      host.remove();
      // The map entry goes on the next sync, which drops disconnected hosts.
    }, AGENT_FADE_MS),
  );
}

function cancelFade(host: HTMLElement): void {
  const timer = fadeTimers.get(host);
  if (timer !== undefined) {
    clearTimeout(timer);
    fadeTimers.delete(host);
  }
  host.removeAttribute(LEAVING_ATTR);
}

/** Negative while the block is in view, so the marker can hang into the gutter. */
function clipAbove(topInFrame: number, scale: number): number {
  // The overhang is drawn unzoomed, so the scale does not apply to it.
  return topInFrame < 0 ? -topInFrame * scale : -MARKER_OVERHANG;
}

/**
 * From the frame's own width rather than its transform, which says nothing
 * about how the two documents line up.
 */
function frameScale(frame: HTMLElement | null): number {
  if (frame === null || frame.clientWidth === 0) {
    return 1;
  }
  return frame.getBoundingClientRect().width / frame.clientWidth;
}

function componentElement(doc: Document, componentId: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-puck-component="${componentId}"]`);
}

/** The canvas is another document, so `instanceof Element` fails for its nodes. */
function asElement(target: EventTarget | null): Element | null {
  const el = target as Element | null;
  return el !== null && typeof el.closest === 'function' ? el : null;
}

/**
 * The block a pointer landed in. A pointer on an overlay's banner counts as its
 * run's first block, so using the banner does not put it away.
 */
export function agentBlockIdAt(target: EventTarget | null): string | null {
  const el = asElement(target);
  const runKey = el?.closest(`.${HOST_CLASS}`)?.getAttribute(BLOCK_ATTR);
  if (runKey !== null && runKey !== undefined) {
    return agentRunBlocks(runKey)[0] ?? null;
  }
  return el?.closest('[data-puck-component]')?.getAttribute('data-puck-component') ?? null;
}

export function markSelectedAgentHost(
  hosts: Map<string, HTMLElement>,
  componentId: string | null,
): void {
  hosts.forEach((host, runKey) => {
    host.toggleAttribute(
      'data-selected',
      componentId !== null && agentRunBlocks(runKey).includes(componentId),
    );
  });
}

/**
 * A block joins the run before it when it is that block's next sibling and the
 * same agent holds both. Walks the page, since the focus map has no order.
 */
function agentRunKeys(doc: Document, focusMap: Map<string, FocusHighlight>): Set<string> {
  const runs: { ids: string[]; actorId: string }[] = [];
  // Which run each held block landed in. A block joins its own previous
  // sibling's run, so a container's children cannot come between two blocks
  // that are in fact adjacent: the walk descends into them, a cursor following
  // the walk would not.
  const runOf = new Map<Element, number>();

  doc.querySelectorAll('[data-puck-component]').forEach((block) => {
    const componentId = block.getAttribute('data-puck-component');
    const highlight = componentId === null ? undefined : focusMap.get(componentId);
    if (componentId === null || highlight?.isAgent !== true) {
      return;
    }
    const sibling = block.previousElementSibling;
    // A block the agent does not hold is absent here, which is what breaks a
    // run across it.
    const joined = sibling === null ? undefined : runOf.get(sibling);
    const open = joined === undefined ? undefined : runs[joined];
    if (joined !== undefined && open !== undefined && open.actorId === highlight.actorId) {
      open.ids.push(componentId);
      runOf.set(block, joined);
    } else {
      runOf.set(block, runs.length);
      runs.push({ ids: [componentId], actorId: highlight.actorId });
    }
  });

  return new Set(runs.map((run) => run.ids.join(' ')));
}

function agentComponentIds(focusMap: Map<string, FocusHighlight>): Set<string> {
  const ids = new Set<string>();
  focusMap.forEach((highlight, componentId) => {
    if (highlight.isAgent === true) {
      ids.add(componentId);
    }
  });
  return ids;
}

/** Presence can name a block before the canvas has drawn it. */
export function hasUndrawnAgentBlocks(
  doc: Document,
  focusMap: Map<string, FocusHighlight>,
): boolean {
  for (const componentId of agentComponentIds(focusMap)) {
    if (componentElement(doc, componentId) === null) {
      return true;
    }
  }
  return false;
}

/** The element in the page the overlays hang from, added on first use. */
export function agentHostLayer(doc: Document): HTMLElement | null {
  if (doc.body === null) {
    return null;
  }
  const existing = doc.body.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
  if (existing !== null) {
    return existing;
  }
  const layer = doc.createElement('div');
  layer.className = LAYER_CLASS;
  // Also in the stylesheet, but the editor copies that into the page late, and
  // overlays placed before it lands would be a page's height out.
  layer.style.position = 'absolute';
  layer.style.top = '0px';
  layer.style.left = '0px';
  doc.body.appendChild(layer);
  return layer;
}

/**
 * Each run's blocks and everything they sit in: a block only moves when one of
 * these resizes. The body alone will not do, as it can be held at the height of
 * the viewport while the page scrolls past it.
 */
export function agentLayoutTargets(doc: Document, hosts: Map<string, HTMLElement>): Set<Element> {
  const targets = new Set<Element>();
  hosts.forEach((_host, runKey) => {
    agentRunBlocks(runKey).forEach((componentId) => {
      let el: Element | null = componentElement(doc, componentId);
      while (el !== null && el !== doc.documentElement && !targets.has(el)) {
        targets.add(el);
        el = el.parentElement;
      }
    });
  });
  return targets;
}

function insideAgentLayer(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(`.${LAYER_CLASS}`) != null;
}

/**
 * Calls back when the page's markup changes, which catches blocks that move
 * without anything resizing, such as two swapped over.
 */
export function observeAgentPageLayout(doc: Document, onChange: () => void): () => void {
  const observer = new MutationObserver((records) => {
    // Drawing the overlays changes the markup too.
    if (records.some((record) => !insideAgentLayer(record.target))) {
      onChange();
    }
  });
  observer.observe(doc, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
  };
}

/**
 * The editor zooms the page, overlays included. Their boxes should follow; the
 * marker, banner and rim should not, so the stylesheet scales them back by the
 * factor this leaves on the layer.
 */
export function unzoomAgentLayer(layer: HTMLElement, frame: HTMLElement | null): number {
  const unzoom = 1 / frameScale(frame);
  layer.style.setProperty('--agent-unzoom', String(unzoom));
  return unzoom;
}

/**
 * Lays each overlay over its run in page coordinates, so the page carries it as
 * it scrolls. Returns the runs too near the top of the page for their marker to
 * hang above them.
 */
export function placeAgentHosts(
  doc: Document,
  layer: HTMLElement,
  hosts: Map<string, HTMLElement>,
  unzoom = 1,
): Set<string> {
  const origin = layer.getBoundingClientRect();
  const pageTop = doc.documentElement.getBoundingClientRect().top;
  const flush = new Set<string>();

  hosts.forEach((host, runKey) => {
    const ids = agentRunBlocks(runKey);
    const head = ids[0];
    const tail = ids.at(-1);
    const first = head === undefined ? null : componentElement(doc, head);
    const last = tail === undefined ? null : componentElement(doc, tail);
    if (first === null || last === null) {
      return;
    }
    const rect = first.getBoundingClientRect();
    const bottom = last.getBoundingClientRect().bottom;

    host.style.top = `${rect.top - origin.top}px`;
    host.style.left = `${rect.left - origin.left}px`;
    host.style.width = `${rect.width}px`;
    host.style.height = `${bottom - rect.top}px`;

    if (rect.top - pageTop < MARKER_OVERHANG * unzoom) {
      flush.add(runKey);
    }
  });

  return flush;
}

/**
 * Lays each gutter marker over its run from outside the page, which the page
 * does not carry as it scrolls: shifted by where the frame sits and scaled by
 * the editor's zoom.
 */
export function positionAgentHosts(
  doc: Document,
  mount: HTMLElement,
  hosts: Map<string, HTMLElement>,
): void {
  const frame = mount.ownerDocument.getElementById('preview-frame');
  const frameRect = frame?.getBoundingClientRect();
  const mountRect = mount.getBoundingClientRect();
  const originTop = frameRect === undefined ? 0 : frameRect.top - mountRect.top;
  const originLeft = frameRect === undefined ? 0 : frameRect.left - mountRect.left;
  const scale = frameScale(frame);
  const clipRect = mount.parentElement?.getBoundingClientRect();
  const roomAbovePage = clipRect === undefined ? 0 : mountRect.top - clipRect.top;
  const frameHeight = frame?.clientHeight ?? 0;

  hosts.forEach((host, runKey) => {
    const ids = agentRunBlocks(runKey);
    const head = ids[0];
    const tail = ids.at(-1);
    const first = head === undefined ? null : componentElement(doc, head);
    const last = tail === undefined ? null : componentElement(doc, tail);
    if (first === null || last === null) {
      return;
    }
    // Against the frame's viewport, so the page's scroll is already in it.
    const rect = first.getBoundingClientRect();
    const bottom = last.getBoundingClientRect().bottom;
    const top = originTop + rect.top * scale;

    host.style.top = `${top}px`;
    host.style.left = `${originLeft + rect.left * scale}px`;
    host.style.width = `${rect.width * scale}px`;
    host.style.height = `${(bottom - rect.top) * scale}px`;

    // A run scrolled out of the frame would otherwise be drawn over the editor.
    const offscreen = frameHeight > 0 && (bottom <= 0 || rect.top >= frameHeight);
    host.style.display = offscreen ? 'none' : '';

    // Compared in frame space and scaled after: clientHeight is unzoomed.
    host.style.setProperty('--agent-clip-top', `${clipAbove(rect.top, scale)}px`);
    host.style.setProperty(
      '--agent-clip-bottom',
      `${frameHeight > 0 ? Math.max(0, bottom - frameHeight) * scale : 0}px`,
    );

    // With the gutter closed the marker moves to the bottom edge. Not for
    // scroll: a run on its way out of view is cut off instead.
    host.toggleAttribute('data-at-page-top', roomAbovePage < MARKER_OVERHANG);
  });
}

/**
 * Gives each run the agents hold a mount point and takes away released ones.
 * A released run keeps its mount point for `AGENT_FADE_MS` so it can fade; one
 * whose blocks the canvas dropped loses it at once. Placing is the caller's job.
 */
export function syncAgentHosts(
  doc: Document,
  mount: HTMLElement,
  focusMap: Map<string, FocusHighlight>,
  hosts: Map<string, HTMLElement>,
): Map<string, HTMLElement> {
  const wanted = agentRunKeys(doc, focusMap);
  const next = new Map(hosts);
  let changed = false;

  hosts.forEach((host, runKey) => {
    // Not `isConnected`: a host left in a replaced canvas document still is.
    const standing =
      agentRunBlocks(runKey).every((id) => componentElement(doc, id) !== null) &&
      host.parentElement === mount;

    if (wanted.has(runKey) && standing) {
      cancelFade(host);
      return;
    }

    if (standing) {
      startFade(host);
      return;
    }

    cancelFade(host);
    host.remove();
    next.delete(runKey);
    changed = true;
  });

  wanted.forEach((runKey) => {
    if (next.has(runKey)) {
      return;
    }
    // Adopt one already on the page: the caller's map can lag behind it.
    const host =
      mount.querySelector<HTMLElement>(`.${HOST_CLASS}[${BLOCK_ATTR}="${runKey}"]`) ??
      mount.ownerDocument.createElement('div');
    if (!host.isConnected) {
      host.className = HOST_CLASS;
      host.setAttribute(BLOCK_ATTR, runKey);
      host.setAttribute(TEST_ID_ATTR, HOST_TEST_ID);
      mount.appendChild(host);
    }
    host.style.setProperty(
      '--focus-color',
      focusMap.get(agentRunBlocks(runKey)[0] ?? '')?.color ?? '',
    );
    next.set(runKey, host);
    changed = true;
  });

  return changed ? next : hosts;
}

/**
 * Draws the marker of each run at the very top of the page in the gutter, where
 * the page's edge would cut it in half, and tells the run's overlay not to draw
 * its own. A marker fades, returns and goes with its overlay.
 */
export function syncAgentGutterMarkers(
  doc: Document,
  mount: HTMLElement,
  hosts: Map<string, HTMLElement>,
  flush: Set<string>,
  markers: Map<string, HTMLElement>,
): Map<string, HTMLElement> {
  const next = new Map(markers);
  let changed = false;

  markers.forEach((marker, runKey) => {
    const host = hosts.get(runKey);
    // The editor rebuilds the mount when the viewport changes.
    if (host?.isConnected === true && flush.has(runKey) && marker.parentElement === mount) {
      return;
    }
    marker.remove();
    next.delete(runKey);
    changed = true;
  });

  hosts.forEach((host, runKey) => {
    const leaving = host.hasAttribute(LEAVING_ATTR);
    const wanted = flush.has(runKey) && host.isConnected;
    // A fading overlay keeps the marker it had, or a second would fade in.
    if (!leaving) {
      host.toggleAttribute(GUTTER_MARKER_ATTR, wanted);
    }
    if (!wanted) {
      return;
    }
    let marker = next.get(runKey);
    if (marker === undefined) {
      if (leaving) {
        return;
      }
      marker =
        mount.querySelector<HTMLElement>(`.${HOST_CLASS}[${BLOCK_ATTR}="${runKey}"]`) ??
        mount.ownerDocument.createElement('div');
      if (!marker.isConnected) {
        marker.className = HOST_CLASS;
        marker.setAttribute(BLOCK_ATTR, runKey);
        marker.setAttribute(GUTTER_ATTR, '');
        marker.setAttribute(TEST_ID_ATTR, GUTTER_MARKER_TEST_ID);
        mount.appendChild(marker);
      }
      next.set(runKey, marker);
      changed = true;
    }
    if (leaving) {
      startFade(marker);
    } else {
      cancelFade(marker);
    }
    marker.style.setProperty('--focus-color', host.style.getPropertyValue('--focus-color'));
  });

  positionAgentHosts(doc, mount, next);
  return changed ? next : markers;
}
