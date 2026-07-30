/**
 * ThumbnailCard
 *
 * One card in the visual component sidebar grid: a live preview above a
 * centered, human-readable name.
 *
 * To keep opening a category feeling instant, the expensive live <Render> is
 * NOT mounted on the first commit unless a preview is already cached.
 * Otherwise, a lightweight skeleton paints immediately and the real preview
 * is scheduled on idle time, then swapped in. The preview is wrapped in an
 * error boundary so a single misbehaving component degrades to a placeholder
 * rather than taking down the drawer.
 *
 * Seeding `ready` from the cache matters beyond the first paint: Puck's own
 * <Drawer>/<Drawer.Item> primitives remount on unrelated editor state changes
 * (e.g. typing in any field), which remounts every ThumbnailCard too. Without
 * the cache check, `ready` would reset to false on every one of those
 * remounts, flashing the skeleton back in even for previews already rendered.
 */

import React from 'react';
import { LiveThumbnail } from './LiveThumbnail.js';
import { humanizeComponentName } from './humanizeComponentName.js';
import { getCachedThumbnail, getThumbnailCacheKey } from './thumbnailCache.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RenderConfig = any;

/** Default preview-card height in pixels, shared across LiveThumbnail, ThumbnailCard, and the drawer. */
export const DEFAULT_THUMBNAIL_HEIGHT = 96;

export interface ThumbnailCardProps {
  config: RenderConfig;
  name: string;
  /** Preferred display name; falls back to a humanized component key. */
  label?: string;
  scale?: number;
  /** Fixed height of the preview area, in pixels. */
  height?: number;
}

// ─── Idle scheduling (with a jsdom/SSR-safe fallback) ───────────────────────

function scheduleIdle(cb: () => void): number {
  const ric = (globalThis as { requestIdleCallback?: (c: () => void) => number }).requestIdleCallback;
  if (ric) return ric(cb);
  return setTimeout(cb, 1) as unknown as number;
}

function cancelIdle(id: number): void {
  const cic = (globalThis as { cancelIdleCallback?: (i: number) => void }).cancelIdleCallback;
  if (cic) cic(id);
  else clearTimeout(id);
}

// ─── Error boundary ─────────────────────────────────────────────────────────

class PreviewErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Skeleton({ height }: { height: number }) {
  return (
    <div
      role="status"
      aria-label="Loading preview"
      style={{
        height,
        background:
          'linear-gradient(90deg, #f1f3f5 25%, #e9ecef 37%, #f1f3f5 63%)',
        backgroundSize: '400% 100%',
        animation: 'p1-thumb-shimmer 1.2s ease-in-out infinite',
      }}
    />
  );
}

function PreviewUnavailable({ height }: { height: number }) {
  return (
    <div
      role="img"
      aria-label="Preview unavailable"
      style={{
        height,
        display: 'grid',
        placeItems: 'center',
        background: '#f8f9fa',
        color: '#adb5bd',
        fontSize: 11,
      }}
    >
      No preview
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function ThumbnailCardImpl({ config, name, label, scale, height = DEFAULT_THUMBNAIL_HEIGHT }: ThumbnailCardProps) {
  const [ready, setReady] = React.useState(
    () => getCachedThumbnail(getThumbnailCacheKey(config, name)) !== undefined,
  );

  React.useEffect(() => {
    if (ready) return;
    let cancelled = false;
    const id = scheduleIdle(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      cancelIdle(id);
    };
  }, [ready]);

  const displayName = label ?? humanizeComponentName(name);

  return (
    <div className="p1-thumb-card">
      {ready ? (
        <PreviewErrorBoundary fallback={<PreviewUnavailable height={height} />}>
          <LiveThumbnail config={config} name={name} scale={scale} height={height} />
        </PreviewErrorBoundary>
      ) : (
        <Skeleton height={height} />
      )}
      <div className="p1-thumb-card__label" title={displayName}>{displayName}</div>
    </div>
  );
}

/** Memoized so a category re-expand keeps already-rendered cards mounted. */
export const ThumbnailCard = React.memo(ThumbnailCardImpl);
