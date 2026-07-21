/**
 * FocusRegionHighlight Component
 *
 * Overlays visual highlights on Puck components that match actor's focusRegions.
 * Integrates with Puck's component tree.
 */

import React from 'react';
import type { ActorPresence } from '@pantheon-systems/css-client';

export interface FocusRegionHighlightProps {
  /** Actor whose regions to highlight */
  actor: ActorPresence;
  /** Color for highlight (auto-assigned if not provided) */
  color?: string;
}

const baseClass = 'css-puck-focus-highlight';

/**
 * Generate a consistent color based on actor ID.
 */
function generateColorFromId(id: string): string {
  // Simple hash to generate a hue value
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Overlays visual highlights on Puck components that match actor's focusRegions.
 * Integrates with Puck's component tree.
 */
export function FocusRegionHighlight({
  actor,
  color,
}: FocusRegionHighlightProps): React.JSX.Element | null {
  const { focusRegions, state, name } = actor;

  // Don't render if no focus regions
  if (!focusRegions || focusRegions.length === 0) {
    return null;
  }

  const isEditing = state === 'editing';
  const highlightColor = color || generateColorFromId(actor.actorId);

  const containerClasses = [
    baseClass,
    isEditing && `${baseClass}--editing`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={containerClasses}
      style={{ '--highlight-color': highlightColor } as React.CSSProperties}
      aria-label={`Focus regions for ${name}`}
    >
      {focusRegions.map((region) => (
        <div
          key={region}
          className={`${baseClass}__region`}
          data-region={region}
        />
      ))}
    </div>
  );
}
