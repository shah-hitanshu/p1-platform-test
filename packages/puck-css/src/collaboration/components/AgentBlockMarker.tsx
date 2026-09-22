/**
 * Rendered into the page canvas, which the design system's stylesheet does not
 * reach, so the icon is sized and coloured from `styles.css`.
 */

import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

export interface AgentBlockMarkerProps {
  /** The name the editor shows for the agent */
  actorName: string;
}

/**
 * The badge astride a held block's top edge, on its own for where the overlay
 * cannot reach past that edge.
 */
export function AgentBlockMarker({ actorName }: AgentBlockMarkerProps): React.JSX.Element {
  return (
    <span className="focus-region-agent__marker" data-testid="agent-block-marker">
      <span className="focus-region-agent__avatar">
        <Icon iconName="sparkles" className="focus-region-agent__icon" />
      </span>
      <span className="focus-region-agent__name" data-testid="agent-block-marker-name">
        {actorName}
      </span>
    </span>
  );
}
