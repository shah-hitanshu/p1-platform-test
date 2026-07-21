/**
 * AgentActivityBanner Component
 *
 * Banner shown when an agent is actively editing the document.
 * Displays agent name, intent, and affected regions.
 */

import React, { useState } from 'react';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { getAvatarColor } from '../utils/avatarColor.js';

export interface AgentActivityBannerProps {
  /** The agent actor to display */
  agent: ActorPresence;
  /** Show even when agent is idle (default: false) */
  showIdle?: boolean;
  /** Allow dismissing the banner (default: false) */
  dismissible?: boolean;
  /** Handler when stop agent button is clicked */
  onStopAgent?: (agent: ActorPresence) => void;
  /** Custom className */
  className?: string;
}

const baseClass = 'css-puck-agent-banner';

/**
 * Get initials from a name.
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/**
 * Banner shown when an agent is actively editing the document.
 * Displays agent name, intent, and affected regions.
 */
export function AgentActivityBanner({
  agent,
  showIdle = false,
  dismissible = false,
  onStopAgent,
  className,
}: AgentActivityBannerProps): React.JSX.Element | null {
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't show if agent is idle and showIdle is false
  if (agent.state === 'idle' && !showIdle) {
    return null;
  }

  // Don't show if dismissed
  if (isDismissed) {
    return null;
  }

  const containerClasses = [
    baseClass,
    `${baseClass}--${agent.state}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  const handleStopAgent = () => {
    onStopAgent?.(agent);
  };

  return (
    <div className={containerClasses} role="alert" aria-live="polite">
      <div className={`${baseClass}__content`}>
        <div
          className={`${baseClass}__avatar`}
          style={{ backgroundColor: getAvatarColor(agent.actorId) }}
        >
          <span className={`${baseClass}__initials`}>{getInitials(agent.name)}</span>
          <span className={`${baseClass}__agent-icon`} aria-hidden="true" />
        </div>

        <div className={`${baseClass}__info`}>
          <span className={`${baseClass}__name`}>{agent.name}</span>
          {agent.intent && (
            <span className={`${baseClass}__intent`}>{agent.intent}</span>
          )}
        </div>

        {agent.focusRegions && agent.focusRegions.length > 0 && (
          <div className={`${baseClass}__regions`}>
            <span className={`${baseClass}__regions-label`}>Editing:</span>
            {agent.focusRegions.map((region) => (
              <span key={region} className={`${baseClass}__region`}>
                {region}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={`${baseClass}__actions`}>
        <button
          type="button"
          className={`pds-button pds-button--critical-secondary pds-button--sm ${baseClass}__stop-btn`}
          onClick={handleStopAgent}
          aria-label="Stop Agent"
        >
          Stop Agent
        </button>

        {dismissible && (
          <button
            type="button"
            className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__dismiss-btn`}
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
