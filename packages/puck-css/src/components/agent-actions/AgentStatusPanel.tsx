/**
 * AgentStatusPanel Component
 *
 * Panel showing an agent's current status and activity.
 * Includes progress indicator, intent, and cancel button.
 */

import React from 'react';
import type { RegisteredAgent } from '@pantheon/css-client';
import type { AgentAction, AgentTriggerStatus } from '../../hooks/useAgentTrigger.js';

export interface AgentStatusPanelProps {
  /** Agent to display status for */
  agent: RegisteredAgent;
  /** Current status */
  status: AgentTriggerStatus;
  /** Current action if any */
  activeAction?: AgentAction;
  /** Show in compact mode */
  compact?: boolean;
  /** Cancel action callback */
  onCancel?: () => void;
}

const baseClass = 'css-puck-agent-status';

/**
 * Get a human-readable status label.
 */
function getStatusLabel(status: AgentTriggerStatus): string {
  switch (status) {
    case 'checking':
      return 'Checking permissions...';
    case 'starting':
      return 'Starting...';
    case 'editing':
      return 'Editing';
    case 'completing':
      return 'Completing...';
    case 'error':
      return 'Error';
    case 'idle':
    default:
      return 'Idle';
  }
}

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
 * Panel showing an agent's current status and activity.
 * Includes progress indicator, intent, and cancel button.
 */
export function AgentStatusPanel({
  agent,
  status,
  activeAction,
  compact = false,
  onCancel,
}: AgentStatusPanelProps): React.JSX.Element {
  const isActive = status !== 'idle';

  const containerClasses = [
    baseClass,
    `${baseClass}--${status}`,
    compact && `${baseClass}--compact`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses}>
      <div className={`${baseClass}__header`}>
        <div className={`${baseClass}__avatar`}>
          <span className={`${baseClass}__initials`}>{getInitials(agent.name)}</span>
          <span className={`${baseClass}__agent-icon`} aria-hidden="true" />
        </div>

        <div className={`${baseClass}__info`}>
          <span className={`${baseClass}__name`}>{agent.name}</span>
          {agent.description && !compact && (
            <span className={`${baseClass}__description`}>{agent.description}</span>
          )}
        </div>

        <div className={`${baseClass}__status`}>
          <span
            className={[
              `${baseClass}__status-badge`,
              `${baseClass}__status-badge--${status}`,
            ].join(' ')}
          >
            {getStatusLabel(status)}
          </span>
        </div>
      </div>

      {activeAction && (
        <div className={`${baseClass}__action`}>
          <span className={`${baseClass}__intent`}>{activeAction.intent}</span>
          {activeAction.targetRegions.length > 0 && !compact && (
            <div className={`${baseClass}__regions`}>
              {activeAction.targetRegions.map((region) => (
                <span key={region} className={`${baseClass}__region`}>
                  {region}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {!compact && agent.capabilities && agent.capabilities.length > 0 && (
        <div className={`${baseClass}__capabilities`}>
          {agent.capabilities.map((capability) => (
            <span key={capability} className={`${baseClass}__capability`}>
              {capability}
            </span>
          ))}
        </div>
      )}

      {isActive && onCancel && (
        <div className={`${baseClass}__actions`}>
          <button
            type="button"
            className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__cancel-btn`}
            onClick={onCancel}
            aria-label="Cancel action"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
