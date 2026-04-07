/**
 * buildThumbnailOverride
 *
 * Builds a Puck `componentItem` override that shows a schematic SVG thumbnail
 * alongside the component name and a drag-handle affordance.
 *
 * The caller provides a `thumbnailMap` — a plain record from component name to
 * a zero-argument React function component that renders the SVG wireframe.
 * Unknown names fall back to a generic line-stub placeholder so the drawer
 * always looks consistent even if a thumbnail hasn't been designed yet.
 *
 * Layout: [thumbnail 48×32] [name — flex 1] [grip dots]
 */

import React from 'react';
import type { PuckOverrides } from '../plugin/index.js';

/** A zero-argument React component that renders a thumbnail SVG. */
export type ThumbnailFC = React.FC;

/** Map from Puck component name to its thumbnail component. */
export type ThumbnailMap = Record<string, ThumbnailFC>;

// ─── Fallback placeholder ──────────────────────────────────────────────────────

function GenericThumbnail() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 60 40"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <rect width={60} height={40} fill="#2c3035" />
      <rect x={4} y={6}  width={52} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
      <rect x={4} y={11} width={40} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
      <rect x={4} y={16} width={44} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
      <rect x={4} y={21} width={36} height={2.5} fill="rgba(255,255,255,0.14)" rx={1} />
    </svg>
  );
}

// ─── Grip handle ──────────────────────────────────────────────────────────────

function GripHandle() {
  return (
    <svg
      width={10}
      height={14}
      viewBox="0 0 10 14"
      fill="none"
      style={{ flexShrink: 0, opacity: 0.35 }}
      aria-hidden="true"
    >
      {[0, 4, 8].map((y) =>
        [0, 4].map((x) => (
          <circle key={`${x}-${y}`} cx={x + 2} cy={y + 3} r={1.2} fill="currentColor" />
        )),
      )}
    </svg>
  );
}

// ─── Thumbnail wrapper ─────────────────────────────────────────────────────────

function Thumbnail({ name, thumbnailMap }: { name: string; thumbnailMap: ThumbnailMap }) {
  const ThumbnailFn = thumbnailMap[name] ?? GenericThumbnail;
  return (
    <div
      style={{ width: 48, height: 32, flexShrink: 0, borderRadius: 3, overflow: 'hidden' }}
      aria-label={`${name} layout preview`}
    >
      <ThumbnailFn />
    </div>
  );
}

// ─── Public builder ───────────────────────────────────────────────────────────

/**
 * Returns a partial `PuckOverrides` object containing a `componentItem` override
 * that renders a thumbnail, the component name, and a drag-handle affordance.
 *
 * Pass the result to `useCSSEditor`'s `additionalOverrides` or merge it with
 * your existing overrides.
 */
export function buildThumbnailOverride(thumbnailMap: ThumbnailMap): Partial<PuckOverrides> {
  return {
    drawerItem: ({ name }: { name: string; children: React.ReactNode }) => (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '6px 8px',
          borderRadius: 6,
          cursor: 'grab',
          boxSizing: 'border-box',
        }}
      >
        <Thumbnail name={name} thumbnailMap={thumbnailMap} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        <GripHandle />
      </div>
    ),
  };
}
