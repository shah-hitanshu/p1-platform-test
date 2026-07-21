/**
 * AgentCheckpointBadge Component
 *
 * Displays a badge indicating agent-created checkpoint with attribution details.
 * Shows agent name, trigger type, and status indicators.
 */

import React, { useState } from 'react';
import type { Checkpoint } from '@pantheon-systems/css-client';

export interface AgentCheckpointBadgeProps {
  /** The checkpoint to display badge for */
  checkpoint: Checkpoint;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Additional CSS class name */
  className?: string;
}

const baseClass = 'css-puck-agent-checkpoint-badge';

/**
 * Get a human-readable trigger label.
 */
function getTriggerLabel(trigger?: string): string {
  switch (trigger) {
    case 'human_requested':
      return 'Requested';
    case 'autonomous':
      return 'Autonomous';
    default:
      return '';
  }
}

/**
 * Badge component for agent-created checkpoints.
 * Shows agent attribution, trigger type, and rollback status.
 */
export function AgentCheckpointBadge({
  checkpoint,
  showTooltip = false,
  className,
}: AgentCheckpointBadgeProps): React.JSX.Element | null {
  const [isHovered, setIsHovered] = useState(false);

  // Don't render for user checkpoints
  if (checkpoint.createdByType !== 'agent') {
    return null;
  }

  const isRolledBack = checkpoint.status === 'rolled_back';
  const triggerLabel = getTriggerLabel(checkpoint.trigger);

  const containerClasses = [
    baseClass,
    isRolledBack && `${baseClass}--rolled-back`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleMouseEnter = () => {
    if (showTooltip) {
      setIsHovered(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div
      className={containerClasses}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className={`${baseClass}__icon`} aria-label="Agent" role="img" />

      <span className={`${baseClass}__name`}>
        {checkpoint.createdByName || 'Agent'}
      </span>

      {triggerLabel && (
        <span
          className={[
            `${baseClass}__trigger`,
            `${baseClass}__trigger--${checkpoint.trigger}`,
          ].join(' ')}
        >
          {triggerLabel}
        </span>
      )}

      {isRolledBack && (
        <span className={`${baseClass}__status ${baseClass}__status--rolled-back`}>
          Rolled back
        </span>
      )}

      {showTooltip && isHovered && (
        <div className={`${baseClass}__tooltip`}>
          {checkpoint.description && (
            <p className={`${baseClass}__tooltip-description`}>
              {checkpoint.description}
            </p>
          )}

          {checkpoint.operationType && (
            <p className={`${baseClass}__tooltip-operation`}>
              Operation: {checkpoint.operationType}
            </p>
          )}

          {checkpoint.affectedRegions && checkpoint.affectedRegions.length > 0 && (
            <div className={`${baseClass}__tooltip-regions`}>
              <span>Affected regions:</span>
              <ul>
                {checkpoint.affectedRegions.map((region) => (
                  <li key={region}>{region}</li>
                ))}
              </ul>
            </div>
          )}

          {checkpoint.requestedByName && (
            <p className={`${baseClass}__tooltip-requester`}>
              Requested by: {checkpoint.requestedByName}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
