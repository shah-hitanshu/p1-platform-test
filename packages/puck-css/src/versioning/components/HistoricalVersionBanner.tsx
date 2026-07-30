import React from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { formatVersionDate } from '../utils/formatVersionDate.js';
import { VersionBannerActions } from './VersionBannerActions.js';

export interface HistoricalVersionBannerProps {
  /** The historical version being viewed. Omit when the version is not yet loaded — shows exit-only banner. */
  version?: DocumentVersion;
  /** Callback to return to the latest version. */
  onReturnToLatest: () => void;
  /** Callback to revert to the viewed version (creates a new version). */
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  /** Whether the current user is allowed to revert (admin/editor only). */
  canRevert?: boolean;
  /** Whether a return-to-latest is in progress (shows a loading state). */
  isReturning?: boolean;
  /** Additional CSS class name. */
  className?: string;
  /** Called when the user clicks the "Previous" (older) stepper. */
  onPrevious?: () => void;
  /** Called when the user clicks the "Next" (newer) stepper. */
  onNext?: () => void;
  /** Whether there is an older version to step to. */
  hasPrevious?: boolean;
  /** Whether there is a newer version to step to. */
  hasNext?: boolean;
}

export function HistoricalVersionBanner({
  version,
  onReturnToLatest,
  onRestoreVersion,
  canRevert = false,
  isReturning = false,
  className = '',
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}: HistoricalVersionBannerProps): React.ReactElement {
  const baseClass = 'historical-version-banner';
  const classes = [baseClass, className].filter(Boolean).join(' ');
  const formattedDate = version ? formatVersionDate(version.createdAt) : null;

  return (
    <div className={classes}>
      <div className={`${baseClass}__icon`} aria-hidden="true">
        <Icon iconName="rotateLeft" iconSize="s" />
      </div>

      <div className={`${baseClass}__content`}>
        <span className={`${baseClass}__text`}>
          Previewing{version && <> <strong>v{version.versionNumber}</strong></>}
        </span>
        {formattedDate && (
          <span className={`${baseClass}__date`}>
            · {formattedDate}
          </span>
        )}
      </div>

      <VersionBannerActions
        version={version}
        onReturnToLatest={onReturnToLatest}
        onRestoreVersion={onRestoreVersion}
        canRevert={canRevert}
        isReturning={isReturning}
        onPrevious={onPrevious}
        onNext={onNext}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
      />
    </div>
  );
}
