/**
 * Rendered into the page canvas, which the design system's stylesheet does not
 * reach, so the icons are sized and coloured from `styles.css`.
 */

import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { AgentBlockMarker } from './AgentBlockMarker.js';

// The design system has no stop icon.
function StopIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden {...props}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}

export interface AgentBlockOverlayProps {
  /** The name the editor shows for the agent */
  actorName: string;
  /** Name of the person the agent is acting for */
  onBehalfOf?: string;
  /** Whether the agent is mid-edit, rather than holding the blocks idle */
  isEditing: boolean;
  /** How many blocks this marker covers; defaults to one */
  blockCount?: number;
  /** Called when the reader asks for the agent to stop */
  onStop: () => void;
}

/**
 * The badge on a block an agent holds and, while it works, a banner naming who
 * asked for the work, with a control to stop it.
 */
export function AgentBlockOverlay({
  actorName,
  onBehalfOf,
  isEditing,
  blockCount = 1,
  onStop,
}: AgentBlockOverlayProps): React.JSX.Element {
  // Empty as well as absent: a blank name would leave the preposition dangling,
  // in the banner and in the stop button's accessible name.
  const label =
    onBehalfOf === undefined || onBehalfOf === ''
      ? actorName
      : `${actorName} on behalf of ${onBehalfOf}`;
  const banner = blockCount > 1 ? `${label} \u00b7 ${blockCount} blocks` : label;

  return (
    <>
      {isEditing && (
        <span
          className="focus-region-agent__shimmer"
          aria-hidden="true"
          data-testid="agent-block-shimmer"
        />
      )}

      <AgentBlockMarker actorName={actorName} />

      {isEditing && (
        <div className="focus-region-agent__banner" role="status" data-testid="agent-block-banner">
          <span className="focus-region-agent__label">
            <Icon iconName="sparkles" className="focus-region-agent__icon" />
            {banner}
          </span>
          <button
            type="button"
            className="focus-region-agent__stop"
            aria-label={`Stop ${label}`}
            onClick={onStop}
            data-testid="agent-block-stop"
          >
            <StopIcon className="focus-region-agent__icon" />
            Stop
          </button>
        </div>
      )}
    </>
  );
}
