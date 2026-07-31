/**
 * ConflictNotificationToast Component
 *
 * Displays a toast notification for collaboration conflicts.
 * Shows conflict details with action buttons.
 */

import React from 'react';
import type { ConflictNotification, ConflictNotificationType } from './useConflictNotifications.js';

export interface ConflictNotificationToastProps {
  /** The conflict notification to display */
  notification: ConflictNotification;
  /** Callback when the toast is dismissed */
  onDismiss: (id: string) => void;
  /** Optional action callback */
  onAction?: () => void;
  /** Label for the action button */
  actionLabel?: string;
  /** Additional CSS class name */
  className?: string;
}

const baseClass = 'css-puck-conflict-toast';

/**
 * Get the icon for a notification type.
 */
function getTypeIcon(type: ConflictNotificationType): string {
  switch (type) {
    case 'agent_editing':
      return '🤖';
    case 'human_conflict':
      return '👥';
    case 'agent_checkpoint':
      return '✓';
    case 'agent_kicked':
      return '⚡';
    default:
      return '⚠';
  }
}

/**
 * Get aria-live value for notification type.
 */
function getAriaLive(type: ConflictNotificationType): 'polite' | 'assertive' {
  switch (type) {
    case 'agent_editing':
    case 'human_conflict':
      return 'assertive';
    default:
      return 'polite';
  }
}

/**
 * Toast component for conflict notifications.
 *
 * @example
 * ```tsx
 * <ConflictNotificationToast
 *   notification={notification}
 *   onDismiss={(id) => dismiss(id)}
 *   onAction={() => viewChanges()}
 *   actionLabel="View Changes"
 * />
 * ```
 */
export function ConflictNotificationToast({
  notification,
  onDismiss,
  onAction,
  actionLabel,
  className = '',
}: ConflictNotificationToastProps): React.ReactElement {
  const handleDismiss = () => {
    onDismiss(notification.id);
  };

  const containerClasses = [
    baseClass,
    `${baseClass}--${notification.type}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={containerClasses}
      role="alert"
      aria-live={getAriaLive(notification.type)}
    >
      {/* Icon */}
      <span
        className={`${baseClass}__icon`}
        aria-label="Conflict notification"
        role="img"
      >
        {getTypeIcon(notification.type)}
      </span>

      {/* Content */}
      <div className={`${baseClass}__content`}>
        {/* Agent name header if applicable */}
        {notification.agentName && (
          <div className={`${baseClass}__agent-name`}>
            {notification.agentName}
          </div>
        )}

        {/* Message */}
        <div className={`${baseClass}__message`}>{notification.message}</div>

        {/* Conflicting regions */}
        {notification.conflictingRegions &&
          notification.conflictingRegions.length > 0 && (
            <div className={`${baseClass}__regions`}>
              {notification.conflictingRegions.map((region) => (
                <span key={region} className={`${baseClass}__region`}>
                  {region}
                </span>
              ))}
            </div>
          )}

        {/* Action button */}
        {onAction && actionLabel && (
          <div className={`${baseClass}__actions`}>
            <button
              type="button"
              className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__action`}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__dismiss`}
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}
