import React from 'react';

export interface PreviewPanelOverlayProps {
  children: React.ReactNode;
  /** Whether a historical version is currently being previewed. */
  isViewingHistoricalVersion?: boolean;
  /** Version number being previewed — shown in the overlay label. */
  versionNumber?: number;
  /** Called when the user clicks "Back to current version". */
  onExitPreview?: () => void;
}

export function PreviewPanelOverlay({
  children,
  isViewingHistoricalVersion = false,
  versionNumber,
  onExitPreview,
}: PreviewPanelOverlayProps): React.ReactElement {
  return (
    <div className={`css-preview-panel-overlay__wrapper${isViewingHistoricalVersion ? ' css-preview-panel-overlay__wrapper--readonly' : ''}`}>
      {isViewingHistoricalVersion && (
        <div className="css-preview-panel-overlay" aria-live="polite">
          <div className="css-preview-panel-overlay__label-wrap">
            <p className="css-preview-panel-overlay__label">
              You&apos;re viewing{versionNumber != null ? ` v${versionNumber}` : ' a historical version'}.
            </p>
          </div>
          <div className="css-preview-panel-overlay__btn-wrap">
            <button
              type="button"
              className="css-preview-panel-overlay__btn"
              onClick={onExitPreview}
              disabled={!onExitPreview}
            >
              Back to current version
            </button>
          </div>
        </div>
      )}
      <div
        className={
          isViewingHistoricalVersion
            ? 'css-preview-panel-overlay__content css-preview-panel-overlay__content--dimmed'
            : 'css-preview-panel-overlay__content'
        }
        aria-hidden={isViewingHistoricalVersion ? true : undefined}
      >
        {children}
      </div>
    </div>
  );
}
