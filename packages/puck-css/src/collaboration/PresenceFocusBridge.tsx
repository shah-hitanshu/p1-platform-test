import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useP1Puck } from '../core/P1PuckContext.js';
import { useOptionalPresenceContext } from '../core/PresenceContext.js';
import type { FocusHighlight } from './utils/focusRegionMap.js';
import { createFocusRegionMap } from './utils/focusRegionMap.js';
import { applyFocusHighlights } from './utils/applyFocusHighlights.js';
import {
  syncAgentHosts,
  hasUndrawnAgentBlocks,
  positionAgentHosts,
  agentBlockIdAt,
  markSelectedAgentHost,
  agentRunBlocks,
  agentHostLayer,
  placeAgentHosts,
  syncAgentGutterMarkers,
  unzoomAgentLayer,
  observeAgentPageLayout,
  agentLayoutTargets,
} from './utils/agentBlockHosts.js';
import { agentScrollTarget } from './utils/agentScrollTarget.js';
import { AgentBlockOverlay } from './components/AgentBlockOverlay.js';
import { AgentBlockMarker } from './components/AgentBlockMarker.js';

/**
 * Marks up the canvas with who is working where. A person's highlight is
 * written straight onto Puck's [data-puck-component] elements, since wrapping
 * components re-renders the tree and costs scroll position; an agent's blocks
 * also get an overlay, portalled into mount points of its own.
 *
 * Must be rendered inside P1PuckProvider.
 */
export function PresenceFocusBridge({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const ccr = useP1Puck();
  // Read presence from the dedicated PresenceContext (which updates reactively
  // on presence changes) instead of the main P1Puck context (which now uses
  // a ref-based getter to avoid cascading re-renders through the plugin tree).
  const presenceCtx = useOptionalPresenceContext();
  const prevHighlightedRef = useRef<Set<string>>(new Set());
  // Scroll once per block a turn moves to, not on every presence update.
  const scrolledToRef = useRef<string | null>(null);
  // The sync reads and writes the ref: React may call a state updater twice.
  const agentHostsRef = useRef<Map<string, HTMLElement>>(new Map());
  // A fading host has left the focus map; its last highlight keeps it drawn.
  const lastHighlightRef = useRef<WeakMap<HTMLElement, FocusHighlight>>(new WeakMap());
  const [agentHosts, setAgentHosts] = useState<Map<string, HTMLElement>>(agentHostsRef.current);
  const gutterMarkersRef = useRef<Map<string, HTMLElement>>(new Map());
  const [gutterMarkers, setGutterMarkers] = useState<Map<string, HTMLElement>>(
    gutterMarkersRef.current,
  );

  const focusMap = useMemo(() => {
    const otherActors = presenceCtx?.actors.filter((a) => a.actorId !== userId) ?? [];
    return createFocusRegionMap(ccr.safeData, otherActors);
  }, [presenceCtx, ccr.safeData, userId]);

  // The editor replaces the canvas's document as it starts up and when it
  // rebuilds the frame, and everything below is attached to the old one.
  // Captured, because a frame's load does not bubble.
  const [canvasLoads, setCanvasLoads] = useState(0);
  useEffect(() => {
    const onLoad = (event: Event): void => {
      if ((event.target as Element | null)?.id === 'preview-frame') {
        setCanvasLoads((loads) => loads + 1);
      }
    };
    document.addEventListener('load', onLoad, true);
    return () => {
      document.removeEventListener('load', onLoad, true);
    };
  }, []);

  useEffect(() => {
    const iframe = document.getElementById('preview-frame') as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument ?? document;
    // Looked up each time: the editor mounts the canvas late and rebuilds it
    // when the viewport changes.
    const gutterMount = (): HTMLElement | null =>
      document.getElementById('puck-canvas-root')?.parentElement ?? null;

    // `nearest` leaves a block that is already on screen where it is.
    const followAgent = (): void => {
      const block = agentScrollTarget(doc, focusMap);
      if (!block) {
        return;
      }
      const componentId = block.getAttribute('data-puck-component');
      // Keyed on the turn, not the block alone: an agent still working must not
      // pull back a reader who scrolled away, but a fresh run on that same block
      // has to be shown. An agent that named no turn scrolls once per block, as
      // before.
      const target =
        componentId === null
          ? null
          : `${focusMap.get(componentId)?.turnId ?? ''}:${componentId}`;
      if (target === scrolledToRef.current) {
        return;
      }
      scrolledToRef.current = target;
      const reduceMotion = doc.defaultView?.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      block.scrollIntoView?.({
        block: 'nearest',
        behavior: reduceMotion === true ? 'auto' : 'smooth',
      });
    };

    // Wrapped: layOut is declared below.
    const resizeObserver = new ResizeObserver(() => {
      scheduleLayOut();
    });

    // A keystroke elsewhere on the page, a resize and a zoom can all land in one
    // frame, and the pass reads rects off every block in the run. Run it once
    // for the lot, and not in the middle of the mutation that triggered it.
    let queuedLayOut = 0;
    const scheduleLayOut = (): void => {
      if (queuedLayOut !== 0) return;
      queuedLayOut = window.requestAnimationFrame(() => {
        queuedLayOut = 0;
        layOut();
      });
    };

    const layOut = (): void => {
      // Runs on every change to the page, so skip it when nothing is drawn.
      if (agentHostsRef.current.size === 0 && gutterMarkersRef.current.size === 0) return;
      const layer = agentHostLayer(doc);
      if (layer === null) return;
      agentLayoutTargets(doc, agentHostsRef.current).forEach((el) => {
        resizeObserver.observe(el);
      });
      const unzoom = unzoomAgentLayer(layer, document.getElementById('preview-frame'));
      const flush = placeAgentHosts(doc, layer, agentHostsRef.current, unzoom);

      const mount = gutterMount();
      if (mount === null) return;
      const markers = syncAgentGutterMarkers(
        doc,
        mount,
        agentHostsRef.current,
        flush,
        gutterMarkersRef.current,
      );
      if (markers !== gutterMarkersRef.current) {
        gutterMarkersRef.current = markers;
        setGutterMarkers(markers);
      }
    };

    const sync = (): boolean => {
      prevHighlightedRef.current = applyFocusHighlights(doc, focusMap, prevHighlightedRef.current);

      const layer = agentHostLayer(doc);
      // Reported as undrawn so the observer below keeps looking.
      if (layer === null) return false;

      const hosts = syncAgentHosts(doc, layer, focusMap, agentHostsRef.current);
      if (hosts !== agentHostsRef.current) {
        agentHostsRef.current = hosts;
        setAgentHosts(hosts);
      }
      layOut();

      followAgent();

      return !hasUndrawnAgentBlocks(doc, focusMap);
    };

    const drawn = sync();

    // Only the gutter's markers move on scroll; the page carries the rest.
    const reposition = (): void => {
      if (gutterMarkersRef.current.size === 0) return;
      const mount = gutterMount();
      if (mount !== null) positionAgentHosts(doc, mount, gutterMarkersRef.current);
    };
    // Puck's selection is out of reach here, so the pointer says which block is
    // picked out. Capture, as a component may stop the event.
    const trackSelection = (event: Event): void => {
      markSelectedAgentHost(agentHostsRef.current, agentBlockIdAt(event.target));
    };
    doc.addEventListener('pointerdown', trackSelection, true);

    const stopObservingLayout = observeAgentPageLayout(doc, scheduleLayOut);
    doc.defaultView?.addEventListener('resize', scheduleLayOut);
    doc.addEventListener('scroll', reposition, true);
    // The zoom is a transform, which resizes nothing. Matched on the element it
    // runs on, since the document would hear every hover in the editor.
    const onZoomEnd = (event: TransitionEvent): void => {
      if (event.target === document.getElementById('puck-canvas-root')) scheduleLayOut();
    };
    window.addEventListener('resize', scheduleLayOut);
    document.addEventListener('scroll', reposition, true);
    document.addEventListener('transitionend', onZoomEnd, true);

    // Presence can name a block before the canvas draws it; watch until it does.
    const observer = new MutationObserver(() => {
      if (sync()) observer.disconnect();
    });
    // The document, not its body: the frame may not have one yet.
    if (!drawn) observer.observe(doc, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      stopObservingLayout();
      if (queuedLayOut !== 0) window.cancelAnimationFrame(queuedLayOut);
      doc.defaultView?.removeEventListener('resize', scheduleLayOut);
      doc.removeEventListener('scroll', reposition, true);
      doc.removeEventListener('pointerdown', trackSelection, true);
      window.removeEventListener('resize', scheduleLayOut);
      document.removeEventListener('scroll', reposition, true);
      document.removeEventListener('transitionend', onZoomEnd, true);
    };
  }, [focusMap, canvasLoads]);

  useEffect(() => {
    [agentHosts, gutterMarkers].forEach((mounts) => {
      mounts.forEach((host, runKey) => {
        const highlight = focusMap.get(agentRunBlocks(runKey)[0] ?? '');
        if (highlight) lastHighlightRef.current.set(host, highlight);
      });
    });
  }, [agentHosts, gutterMarkers, focusMap]);

  const stopAgent = ccr.stopAgent;
  const actors = presenceCtx?.actors;

  const handleStop = useCallback(
    (actorId: string) => {
      const actor = actors?.find((a) => a.actorId === actorId);
      if (actor) void stopAgent(actor);
    },
    [actors, stopAgent],
  );

  return (
    <>
      {children}
      {[...agentHosts].map(([runKey, host]) => {
        const blocks = agentRunBlocks(runKey);
        const highlight = focusMap.get(blocks[0] ?? '') ?? lastHighlightRef.current.get(host);
        if (!highlight) return null;
        return createPortal(
          <AgentBlockOverlay
            actorName={highlight.actorName}
            onBehalfOf={highlight.onBehalfOf}
            isEditing={highlight.isEditing}
            blockCount={blocks.length}
            onStop={() => handleStop(highlight.actorId)}
          />,
          host,
          runKey,
        );
      })}
      {[...gutterMarkers].map(([runKey, marker]) => {
        const highlight =
          focusMap.get(agentRunBlocks(runKey)[0] ?? '') ?? lastHighlightRef.current.get(marker);
        if (!highlight) return null;
        return createPortal(
          <AgentBlockMarker actorName={highlight.actorName} />,
          marker,
          `gutter ${runKey}`,
        );
      })}
    </>
  );
}
