/**
 * PresenceIndicator Component
 *
 * Compact indicator showing presence count with expandable details panel.
 */

import React, { useState } from 'react';
import type { ActorPresence } from '@pantheon-systems/css-client';

export interface PresenceIndicatorProps {
  /** List of actors to display */
  actors: ActorPresence[];
  /** Show detailed presence panel on click */
  expandable?: boolean;
  /** Position of expanded panel */
  panelPosition?: 'top' | 'bottom';
  /** Custom className */
  className?: string;
}

const baseClass = 'css-puck-presence-indicator';

/**
 * Compact indicator showing presence count with expandable details panel.
 * Shows: "3 collaborators" with breakdown on expand.
 */
export function PresenceIndicator({
  actors,
  expandable = true,
  panelPosition = 'bottom',
  className,
}: PresenceIndicatorProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const count = actors.length;
  const label = count === 0 ? 'No collaborators' : count === 1 ? '1 collaborator' : `${count} collaborators`;

  const containerClasses = [baseClass, className].filter(Boolean).join(' ');

  const handleClick = () => {
    if (expandable) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className={containerClasses}>
      <button
        className={`${baseClass}__trigger`}
        onClick={handleClick}
        type="button"
        aria-expanded={expandable ? isExpanded : undefined}
      >
        <span className={`${baseClass}__count`}>{label}</span>
      </button>

      {expandable && isExpanded && (
        <div
          className={`${baseClass}__panel ${baseClass}__panel--${panelPosition}`}
          role="dialog"
          aria-label="Collaborators"
        >
          <ul className={`${baseClass}__list`}>
            {actors.map((actor) => (
              <li key={actor.id} className={`${baseClass}__item`}>
                <div className={`${baseClass}__actor`}>
                  <span className={`${baseClass}__name`}>{actor.name}</span>
                  <span
                    className={`${baseClass}__state ${baseClass}__state--${actor.state}`}
                  >
                    {actor.state}
                  </span>
                </div>
                {actor.focusRegions && actor.focusRegions.length > 0 && (
                  <div className={`${baseClass}__regions`}>
                    {actor.focusRegions.map((region) => (
                      <span key={region} className={`${baseClass}__region`}>
                        {region}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
