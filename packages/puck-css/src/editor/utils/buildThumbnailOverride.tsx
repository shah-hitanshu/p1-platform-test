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
import { GenericThumbnailIcon } from '../icons/GenericThumbnailIcon.js';
import { GripHandleIcon } from '../icons/GripHandleIcon.js';

/** A zero-argument React component that renders a thumbnail SVG. */
export type ThumbnailFC = React.FC;

/** Map from Puck component name to its thumbnail component. */
export type ThumbnailMap = Record<string, ThumbnailFC>;

// ─── Thumbnail wrapper ─────────────────────────────────────────────────────────

function Thumbnail({ name, thumbnailMap }: { name: string; thumbnailMap: ThumbnailMap }) {
  const ThumbnailFn = thumbnailMap[name] ?? GenericThumbnailIcon;
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
 * Pass the result to `useP1Editor`'s `additionalOverrides` or merge it with
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
        <GripHandleIcon />
      </div>
    ),
  };
}
