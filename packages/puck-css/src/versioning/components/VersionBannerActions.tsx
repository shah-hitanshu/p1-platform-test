import React, { useState, useEffect } from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { Icon } from '@pantheon-systems/pds-toolkit-react';

const REVERT_ERROR_FALLBACK = 'Revert failed. Please try again.';

const BASE = 'historical-version-banner';

export interface VersionBannerActionsProps {
  version?: DocumentVersion;
  onReturnToLatest: () => void;
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  canRevert?: boolean;
  isReturning?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

export function VersionBannerActions({
  version,
  onReturnToLatest,
  onRestoreVersion,
  canRevert = false,
  isReturning = false,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}: VersionBannerActionsProps): React.ReactElement {
  const [isReverting, setIsReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => { setRevertError(null); }, [version?.id]);

  const handleRevert = async () => {
    if (!onRestoreVersion || !version) return;
    setIsReverting(true);
    setRevertError(null);
    try {
      await onRestoreVersion(version);
    } catch (err) {
      // Cap server error messages to avoid leaking internal details or long stack traces.
      setRevertError(
        err instanceof Error && err.message.length < 80
          ? err.message
          : REVERT_ERROR_FALLBACK
      );
    } finally {
      setIsReverting(false);
    }
  };

  return (
    <>
      <div className={`${BASE}__actions`}>
        {(onPrevious || onNext) && (
          <div className={`${BASE}__steppers`}>
            {onPrevious && (
              <button
                type="button"
                className={`${BASE}__stepper-btn`}
                aria-label="Previous version"
                disabled={!hasPrevious || isReverting || isReturning}
                onClick={onPrevious}
              >
                <Icon iconName="angleLeft" size="s" aria-hidden="true" />
              </button>
            )}
            {onNext && (
              <button
                type="button"
                className={`${BASE}__stepper-btn`}
                aria-label="Next version"
                disabled={!hasNext || isReverting || isReturning}
                onClick={onNext}
              >
                <Icon iconName="angleRight" size="s" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className={`${BASE}__exit-btn`}
          disabled={isReverting || isReturning}
          aria-busy={isReturning}
          onClick={onReturnToLatest}
          aria-label="Return to current"
        >
          {isReturning ? 'Returning…' : 'Exit preview'}
        </button>

        {canRevert && onRestoreVersion && version && (
          <button
            type="button"
            className={`${BASE}__revert-btn`}
            disabled={isReverting || isReturning}
            aria-busy={isReverting}
            onClick={() => { void handleRevert(); }}
          >
            {isReverting ? (
              <>
                <span className={`${BASE}__spinner`} aria-hidden="true" />
                Reverting…
              </>
            ) : (
              <>
                <Icon iconName="rotateLeft" size="s" aria-hidden="true" />
                Revert to this version
              </>
            )}
          </button>
        )}
      </div>

      {revertError && (
        <p className={`${BASE}__error`} role="alert">
          {revertError}
        </p>
      )}
    </>
  );
}
