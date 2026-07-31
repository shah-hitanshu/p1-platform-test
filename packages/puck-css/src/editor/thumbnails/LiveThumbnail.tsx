/**
 * LiveThumbnail
 *
 * Renders a real, scaled-down preview of a single Puck component using the
 * component's own `defaultProps`, via Puck's <Render>. The preview is clipped
 * to a fixed height and made non-interactive so it reads as a static thumbnail
 * inside the visual component sidebar.
 *
 * Rendering is cached (see thumbnailCache): on a miss we render live and
 * capture the resulting HTML; on a hit we re-inject the cached HTML instead of
 * re-rendering the component. The cache survives editor remounts within a
 * page load, avoiding re-rendering identical previews on every document
 * switch.
 *
 * The initial capture happens right after the component's first commit, but a
 * component that renders its own content asynchronously (e.g. after a fetch,
 * in its own effect) may still be showing a loading state at that point. A
 * MutationObserver keeps watching the live render and re-captures on every
 * DOM change, so the cache converges on the settled output instead of
 * permanently freezing whatever was on screen first.
 *
 * The config handed to Puck's <Render> has its `root` swapped for a
 * pass-through: this preview is a single component, not a page, so it must
 * not run the site's real page-root wrapper (e.g. a title `<h1>`) — that
 * wrapper reflects the actual document currently open in the editor, not
 * this isolated stub, and would otherwise leak into every preview.
 *
 * Unlike the exploratory spike this does NOT self-measure its height — grid
 * cards want a uniform, fixed size, so we clip overflow instead.
 */

import React from 'react';
import { Render } from '@puckeditor/core';
import { getCachedThumbnail, setCachedThumbnail, getThumbnailCacheKey } from './thumbnailCache.js';
import { DEFAULT_THUMBNAIL_HEIGHT } from './ThumbnailCard.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RenderConfig = any;

export interface LiveThumbnailProps {
  /** The Puck config the component belongs to. */
  config: RenderConfig;
  /** Component key to preview (e.g. "HeroBlock"). */
  name: string;
  /** Zoom factor applied to the live render. Lower = more fits. */
  scale?: number;
  /** Fixed height of the clipped preview box, in pixels. */
  height?: number;
}

function LiveThumbnailImpl({ config, name, scale = 0.2, height = DEFAULT_THUMBNAIL_HEIGHT }: LiveThumbnailProps) {
  const defaultProps: Record<string, unknown> = config?.components?.[name]?.defaultProps ?? {};
  const cacheKey = getThumbnailCacheKey(config, name);

  // Read once at mount: a hit lets us skip the live render entirely.
  const [cached] = React.useState(() => getCachedThumbnail(cacheKey));
  const innerRef = React.useRef<HTMLDivElement>(null);

  // Isolated document: this preview is the one component, not a page — the
  // real root wrapper is swapped for a pass-through below.
  const data = {
    root: { props: {} },
    content: [
      {
        type: name,
        props: { id: `thumb-${name}`, ...defaultProps },
      },
    ],
    zones: {},
  };

  const isolatedConfig = React.useMemo(
    () => ({ ...config, root: { render: ({ children }: { children?: React.ReactNode }) => children } }),
    [config],
  );

  // On a miss, capture the live-rendered HTML once it has committed, then
  // keep re-capturing on any further mutation so a component that finishes
  // rendering asynchronously (its own effect, a fetch, an image swap) doesn't
  // get an incomplete snapshot cached permanently.
  //
  // Mutations are debounced through requestAnimationFrame so a burst of DOM
  // changes (e.g. a component updating several nodes at once) produces one
  // capture per frame. Attribute mutations are excluded — they fire continuously
  // for animations and class toggles without changing rendered content.
  // The observer disconnects after 500 ms of DOM quiet so it doesn't run for
  // the drawer's entire lifetime.
  React.useEffect(() => {
    if (cached !== undefined) return;
    const node = innerRef.current;
    if (!node) return;

    const capture = () => {
      const html = node.innerHTML;
      if (html) setCachedThumbnail(cacheKey, html);
    };

    let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const onMutation = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        capture();
        rafId = null;
      });
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => observer.disconnect(), 500);
    };

    capture();
    const observer = new MutationObserver(onMutation);
    observer.observe(node, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [cached, cacheKey]);

  const boxStyle: React.CSSProperties = {
    width: '100%',
    height,
    overflow: 'hidden',
    background: '#fff',
    pointerEvents: 'none',
  };
  const innerStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    width: `${100 / scale}%`,
  };

  return (
    <div style={boxStyle}>
      {cached !== undefined ? (
        // Trusted source: this HTML was produced by our own <Render> of the
        // component's defaultProps — never user input.
        <div style={innerStyle} dangerouslySetInnerHTML={{ __html: cached }} />
      ) : (
        <div style={innerStyle} ref={innerRef}>
          <Render config={isolatedConfig} data={data as Parameters<typeof Render>[0]['data']} />
        </div>
      )}
    </div>
  );
}

/** Memoized so re-expanding a category doesn't re-render existing previews. */
export const LiveThumbnail = React.memo(LiveThumbnailImpl);
