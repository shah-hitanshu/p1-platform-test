/**
 * Historical Version Banner Component
 *
 * Shows a warning banner when viewing a historical (non-latest) version.
 * Provides a button to return to the current version.
 */

import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';

export interface HistoricalVersionBannerProps {
  /**
   * The historical version being viewed.
   */
  version: DocumentVersion;
  /**
   * Callback to return to the latest version.
   */
  onReturnToLatest: () => void;
  /**
   * Additional CSS class name.
   */
  className?: string;
}

/**
 * Formats a date string for display.
 */
function formatVersionDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Banner displayed when viewing a historical version.
 * Shows version info and provides a button to return to current.
 */
export function HistoricalVersionBanner({
  version,
  onReturnToLatest,
  className = '',
}: HistoricalVersionBannerProps): React.ReactElement {
  const baseClass = 'historical-version-banner';
  const classes = [baseClass, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className={`${baseClass}__icon`}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9-3a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7 7h2v5H7V7Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div className={`${baseClass}__content`}>
        <span className={`${baseClass}__text`}>
          Viewing version {version.versionNumber}
        </span>
        <span className={`${baseClass}__date`}>
          {formatVersionDate(version.createdAt)}
        </span>
        <span className={`${baseClass}__locked`}>
          Read-only
        </span>
      </div>
      <button
        type="button"
        className={`pds-button pds-button--primary pds-button--sm ${baseClass}__button`}
        onClick={onReturnToLatest}
      >
        Return to current
      </button>
    </div>
  );
}
