import React, { useState, useEffect } from 'react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { Icon, Tooltip } from '@pantheon-systems/pds-toolkit-react';
import styles from './HistoricalVersionBanner.module.css';

const REVERT_ERROR_FALLBACK = 'Revert failed. Please try again.';

function StepperTooltip({
  content,
  disabled,
  children,
}: {
  content: string;
  disabled: boolean;
  children: React.ReactElement;
}): React.ReactElement {
  if (disabled) return children;
  return <Tooltip content={content} preferredPlacement="top" customTrigger={children} />;
}

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

  const busy = isReverting || isReturning;
  const prevDisabled = !hasPrevious || busy;
  const nextDisabled = !hasNext || busy;

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
      <div className={styles.actions}>
        {(onPrevious || onNext) && (
          <div className={styles.steppers}>
            {onPrevious && (
              <StepperTooltip content="Previous Version" disabled={prevDisabled}>
                <button
                  type="button"
                  className={styles.stepperBtn}
                  aria-label="Previous version"
                  disabled={prevDisabled}
                  onClick={onPrevious}
                >
                  <Icon iconName="angleLeft" size="s" aria-hidden="true" />
                </button>
              </StepperTooltip>
            )}
            {onNext && (
              <StepperTooltip content="Next Version" disabled={nextDisabled}>
                <button
                  type="button"
                  className={styles.stepperBtn}
                  aria-label="Next version"
                  disabled={nextDisabled}
                  onClick={onNext}
                >
                  <Icon iconName="angleRight" size="s" aria-hidden="true" />
                </button>
              </StepperTooltip>
            )}
          </div>
        )}

        <button
          type="button"
          className={styles.exitBtn}
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
            className={styles.revertBtn}
            disabled={isReverting || isReturning}
            aria-busy={isReverting}
            onClick={() => { void handleRevert(); }}
          >
            {isReverting ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
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
        <p className={styles.error} role="alert">
          {revertError}
        </p>
      )}
    </>
  );
}
