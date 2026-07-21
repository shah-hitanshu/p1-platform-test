/**
 * Toast Component
 *
 * Displays a single notification toast.
 */

import React, { useEffect, useState } from 'react';
import type { Notification, NotificationSeverity } from '../../core/types.js';

interface ToastProps {
  /**
   * The notification to display.
   */
  notification: Notification;

  /**
   * Callback when the toast is dismissed.
   */
  onDismiss: (id: string) => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Get the icon for a notification severity.
 */
function getSeverityIcon(severity: NotificationSeverity): string {
  switch (severity) {
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'warning':
      return '⚠';
    case 'info':
    default:
      return 'ℹ';
  }
}

/**
 * Get the accessible label for a severity.
 */
function getSeverityLabel(severity: NotificationSeverity): string {
  switch (severity) {
    case 'success':
      return 'Success';
    case 'error':
      return 'Error';
    case 'warning':
      return 'Warning';
    case 'info':
    default:
      return 'Information';
  }
}

/**
 * Toast component that displays a single notification.
 *
 * @example
 * ```tsx
 * <Toast
 *   notification={{
 *     id: '1',
 *     message: 'Changes saved successfully',
 *     severity: 'success',
 *     createdAt: new Date(),
 *   }}
 *   onDismiss={(id) => removeNotification(id)}
 * />
 * ```
 */
export function Toast({
  notification,
  onDismiss,
  className = '',
}: ToastProps): React.ReactElement {
  const [isExiting, setIsExiting] = useState(false);
  const baseClass = 'css-puck-toast';

  // Handle dismiss with exit animation
  const handleDismiss = () => {
    setIsExiting(true);
    // Allow animation to complete before removing
    setTimeout(() => {
      onDismiss(notification.id);
    }, 200);
  };

  // Handle action click
  const handleActionClick = (onClick: () => void) => {
    onClick();
    handleDismiss();
  };

  // Auto-dismiss progress indicator
  const [progress, setProgress] = useState(100);
  const autoDismissMs = notification.autoDismissMs ?? 0;

  useEffect(() => {
    if (autoDismissMs <= 0) return;

    const startTime = Date.now();
    const updateInterval = 50; // Update every 50ms

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / autoDismissMs) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, updateInterval);

    return () => clearInterval(timer);
  }, [autoDismissMs]);

  return (
    <div
      className={`${baseClass} ${baseClass}--${notification.severity} ${isExiting ? `${baseClass}--exiting` : ''} ${className}`}
      role="alert"
      aria-live={notification.severity === 'error' ? 'assertive' : 'polite'}
    >
      {/* Icon */}
      <span
        className={`${baseClass}__icon ${baseClass}__icon--${notification.severity}`}
        aria-label={getSeverityLabel(notification.severity)}
      >
        {getSeverityIcon(notification.severity)}
      </span>

      {/* Content */}
      <div className={`${baseClass}__content`}>
        {notification.title && (
          <div className={`${baseClass}__title`}>{notification.title}</div>
        )}
        <div className={`${baseClass}__message`}>{notification.message}</div>

        {/* Actions */}
        {notification.actions && notification.actions.length > 0 && (
          <div className={`${baseClass}__actions`}>
            {notification.actions.map((action: { label: string; onClick: () => void }, index: number) => (
              <button
                key={index}
                type="button"
                className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__action`}
                onClick={() => handleActionClick(action.onClick)}
              >
                {action.label}
              </button>
            ))}
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

      {/* Progress bar for auto-dismiss */}
      {autoDismissMs > 0 && (
        <div
          className={`${baseClass}__progress`}
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      )}
    </div>
  );
}
