/**
 * VersionItem Component
 *
 * Displays a single version in the version history list.
 * Supports agent checkpoint attribution and rollback indicators.
 */

import React from 'react';
import type { DocumentVersion, Checkpoint } from '@pantheon/css-client';
import { AgentCheckpointBadge } from './AgentCheckpointBadge.js';

export interface VersionItemProps {
  /** The document version to display */
  version: DocumentVersion;
  /** Optional checkpoint associated with this version */
  checkpoint?: Checkpoint;
  /** Whether this version is currently selected */
  isSelected?: boolean;
  /** Whether to show agent info (for agent checkpoints) */
  showAgentInfo?: boolean;
  /** Whether to use compact display mode */
  compact?: boolean;
  /** Click handler */
  onClick?: (version: DocumentVersion) => void;
  /** Additional CSS class name */
  className?: string;
}

const baseClass = 'css-puck-version-item';

/**
 * Format a date string for display.
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * VersionItem component for displaying a document version.
 * Shows version number, timestamp, checkpoint info, and agent attribution.
 */
export function VersionItem({
  version,
  checkpoint,
  isSelected = false,
  showAgentInfo = false,
  compact = false,
  onClick,
  className,
}: VersionItemProps): React.JSX.Element {
  const containerClasses = [
    baseClass,
    isSelected && `${baseClass}--selected`,
    compact && `${baseClass}--compact`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isAgentCheckpoint = checkpoint?.createdByType === 'agent';
  const isRolledBack = checkpoint?.status === 'rolled_back';

  const handleClick = () => {
    if (onClick) {
      onClick(version);
    }
  };

  return (
    <button
      type="button"
      className={containerClasses}
      onClick={handleClick}
      aria-pressed={isSelected}
    >
      <div className={`${baseClass}__header`}>
        <span className={`${baseClass}__version`}>v{version.versionNumber}</span>
        <span className={`${baseClass}__timestamp`}>
          {formatDate(version.createdAt)}
        </span>
      </div>

      {checkpoint && (
        <div className={`${baseClass}__checkpoint`}>
          <span className={`${baseClass}__checkpoint-name`}>
            {checkpoint.name}
          </span>

          {/* Only show creator name for user checkpoints; agent info shown via badge */}
          {checkpoint.createdByName && !isAgentCheckpoint && (
            <span className={`${baseClass}__creator`}>
              {checkpoint.createdByName}
            </span>
          )}
        </div>
      )}

      {showAgentInfo && isAgentCheckpoint && (
        <div className={`${baseClass}__agent-info`}>
          <AgentCheckpointBadge checkpoint={checkpoint!} />

          {checkpoint.requestedByName && (
            <span className={`${baseClass}__requester`}>
              by {checkpoint.requestedByName}
            </span>
          )}

          {checkpoint.operationType && (
            <span className={`${baseClass}__operation`}>
              {checkpoint.operationType.replace(/_/g, ' ')}
            </span>
          )}

          {!compact && checkpoint.affectedRegions && checkpoint.affectedRegions.length > 0 && (
            <div className={`${baseClass}__regions`}>
              {checkpoint.affectedRegions.map((region) => (
                <span key={region} className={`${baseClass}__region`}>
                  {region}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rollback status shown separately from badge to be more prominent */}
      {isRolledBack && !showAgentInfo && (
        <div className={`${baseClass}__rollback`}>
          <span className={`${baseClass}__rollback-status`}>Rolled back</span>
          {checkpoint.rolledBackAt && (
            <span className={`${baseClass}__rollback-date`}>
              {formatDate(checkpoint.rolledBackAt)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
