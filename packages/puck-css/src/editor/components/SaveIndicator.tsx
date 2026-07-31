/**
 * SaveIndicator Component
 *
 * Displays the current save status.
 * Supports both direct props (legacy) and getter functions (preferred for performance).
 * Using getter functions avoids recreating parent components on status changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { SaveStatus } from '../../core/types.js';

interface SaveIndicatorProps {
  /**
   * Getter function for current save status.
   * Using a getter instead of direct value allows parent components to remain stable.
   * Preferred over `status` prop for performance.
   */
  getStatus?: () => SaveStatus;

  /**
   * Getter function for last successful save timestamp.
   * Preferred over `lastSaved` prop for performance.
   */
  getLastSaved?: () => Date | null;

  /**
   * Getter function for last error (if status is 'error').
   * Preferred over `error` prop for performance.
   */
  getError?: () => Error | null;

  /**
   * Direct save status value (legacy API).
   * @deprecated Use getStatus getter for better performance.
   */
  status?: SaveStatus;

  /**
   * Direct last saved timestamp (legacy API).
   * @deprecated Use getLastSaved getter for better performance.
   */
  lastSaved?: Date | null;

  /**
   * Direct error value (legacy API).
   * @deprecated Use getError getter for better performance.
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
 * Supports both getter functions (preferred) and direct props (legacy).
 * When using getters, the component polls for updates allowing parent components to remain stable.
 *
 * @example
 * ```tsx
 * // Preferred: using getters (avoids parent re-renders)
 * <SaveIndicator
 *   getStatus={() => saveStatusRef.current}
 *   getLastSaved={() => lastSavedRef.current}
 *   getError={() => saveErrorRef.current}
 *   onRetry={saveNow}
 * />
 *
 * // Legacy: using direct props
 * <SaveIndicator
 *   status={saveStatus}
 *   lastSaved={lastSavedDate}
 *   error={saveError}
 *   onRetry={saveNow}
 * />
 * ```
 */
export function SaveIndicator({
  getStatus,
  getLastSaved,
  getError,
  status: directStatus,
  lastSaved: directLastSaved,
  error: directError,
  onRetry,
  className = '',
}: SaveIndicatorProps): React.ReactElement {
  // Determine if using getter API or direct props API
  const usingGetters = typeof getStatus === 'function';

  // Internal state that triggers re-renders when values change
  const [status, setStatus] = useState<SaveStatus>(
    usingGetters && getStatus ? getStatus() : (directStatus ?? 'idle')
  );
  const [lastSaved, setLastSaved] = useState<Date | null>(
    usingGetters ? getLastSaved?.() ?? null : (directLastSaved ?? null)
  );
  const [error, setError] = useState<Error | null>(
    usingGetters ? getError?.() ?? null : (directError ?? null)
  );

  // Poll getters to update internal state (only when using getter API)
  // This allows the component to re-render even though parent props are stable
  const updateFromGetters = useCallback(() => {
    if (!usingGetters) return;

    const newStatus = getStatus();
    const newLastSaved = getLastSaved?.() ?? null;
    const newError = getError?.() ?? null;

    if (newStatus !== status) {
      setStatus(newStatus);
    }
    if (newLastSaved !== lastSaved) {
      setLastSaved(newLastSaved);
    }
    if (newError !== error) {
      setError(newError);
    }
  }, [usingGetters, getStatus, getLastSaved, getError, status, lastSaved, error]);

  // Poll frequently to catch status changes quickly (getter API only)
  useEffect(() => {
    if (!usingGetters) return;

    const interval = setInterval(updateFromGetters, 100);
    return () => clearInterval(interval);
  }, [usingGetters, updateFromGetters]);

  // Also update immediately on mount and when getters change
  useEffect(() => {
    if (usingGetters) {
      updateFromGetters();
    }
  }, [usingGetters, updateFromGetters]);

  // For direct props API, sync state when props change
  useEffect(() => {
    if (!usingGetters && directStatus !== undefined) {
      setStatus(directStatus);
    }
  }, [usingGetters, directStatus]);

  useEffect(() => {
    if (!usingGetters) {
      setLastSaved(directLastSaved ?? null);
    }
  }, [usingGetters, directLastSaved]);

  useEffect(() => {
    if (!usingGetters) {
      setError(directError ?? null);
    }
  }, [usingGetters, directError]);

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
              className={`pds-button pds-button--subtle pds-button--sm ${baseClass}__retry`}
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
