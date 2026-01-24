/**
 * SaveIndicator Component
 *
 * Displays the current save status.
 */

import React from 'react';
import type { SaveStatus } from '../types.js';

interface SaveIndicatorProps {
  /**
   * Current save status.
   */
  status: SaveStatus;

  /**
   * Last successful save timestamp.
   */
  lastSaved: Date | null;

  /**
   * Last error (if status is 'error').
   */
  error?: Error | null;

  /**
   * Callback to retry save on error.
   */
  onRetry?: () => void;

  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Formats a date as a relative time string (e.g., "2 minutes ago").
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 5) {
    return 'just now';
  }

  if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }

  return date.toLocaleString();
}

/**
 * Component that displays the current save status.
 *
 * @example
 * ```tsx
 * <SaveIndicator
 *   status={saveStatus}
 *   lastSaved={lastSaved}
 *   error={saveError}
 *   onRetry={saveNow}
 * />
 * ```
 */
export function SaveIndicator({
  status,
  lastSaved,
  error,
  onRetry,
  className = '',
}: SaveIndicatorProps): React.ReactElement {
  const baseClass = 'css-puck-save-indicator';

  return (
    <div className={`${baseClass} ${baseClass}--${status} ${className}`}>
      {status === 'idle' && lastSaved && (
        <span className={`${baseClass}__text`}>Saved {formatRelativeTime(lastSaved)}</span>
      )}

      {status === 'saving' && (
        <>
          <span className={`${baseClass}__spinner`} aria-hidden="true" />
          <span className={`${baseClass}__text`}>Saving...</span>
        </>
      )}

      {status === 'saved' && (
        <>
          <span className={`${baseClass}__icon ${baseClass}__icon--success`} aria-hidden="true">
            ✓
          </span>
          <span className={`${baseClass}__text`}>
            Saved {lastSaved ? formatRelativeTime(lastSaved) : ''}
          </span>
        </>
      )}

      {status === 'error' && (
        <>
          <span className={`${baseClass}__icon ${baseClass}__icon--error`} aria-hidden="true">
            ✕
          </span>
          <span className={`${baseClass}__text`}>
            Save failed{error ? `: ${error.message}` : ''}
          </span>
          {onRetry && (
            <button
              type="button"
              className={`${baseClass}__retry`}
              onClick={onRetry}
              aria-label="Retry save"
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
}
