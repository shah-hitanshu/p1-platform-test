import React, { useCallback } from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { useP1Puck } from '../../core/P1PuckContext.js';
import { HistoricalVersionBanner } from '../../versioning/components/HistoricalVersionBanner.js';

export interface VersionBannerOverrideProps {
  children: React.ReactNode;
  versions: DocumentVersion[];
  selectedVersionId?: string;
  onVersionSelect?: (version: DocumentVersion) => void;
  onRestoreVersion?: (version: DocumentVersion) => Promise<void>;
  canRevert?: boolean;
  /** The currently filtered version list (from the panel filter). Steppers navigate within this list. */
  filteredVersions?: DocumentVersion[];
}

export function VersionBannerOverride({
  children,
  versions,
  selectedVersionId,
  onVersionSelect,
  onRestoreVersion,
  canRevert = false,
  filteredVersions,
}: VersionBannerOverrideProps): React.ReactElement {
  const p1Context = useP1Puck();
  // versions are newest-first from the API; index 0 is always the current (latest) version.
  const isViewingOld = !!selectedVersionId && versions.length > 0 && selectedVersionId !== versions[0]?.id;
  const viewingVersion = versions.find(v => v.id === selectedVersionId);
  // While a switch is loading the next document, currentDocument is null but
  // the empty state must not flash over the still-visible previous canvas.
  const hasOrIsLoadingDocument = p1Context.currentDocument !== null || p1Context.documentLoading;
  const isReturning = p1Context.isReturningToLatest;

  // Stepper: navigate within the filtered list (falls back to full list if not provided).
  // Newest-first: lower index = newer, higher index = older.
  const stepList = filteredVersions ?? versions;
  const currentIdx = selectedVersionId ? stepList.findIndex(v => v.id === selectedVersionId) : -1;
  const hasPrevious = currentIdx !== -1 && currentIdx < stepList.length - 1;
  const hasNext = currentIdx > 0;
  // Always provide callbacks when previewing so buttons render (disabled state controls usability).
  const handlePrevious = useCallback(
    () => { const t = stepList[currentIdx + 1]; if (hasPrevious && t) onVersionSelect?.(t); },
    [stepList, currentIdx, hasPrevious, onVersionSelect],
  );
  const handleNext = useCallback(
    () => { const t = stepList[currentIdx - 1]; if (hasNext && t) onVersionSelect?.(t); },
    [stepList, currentIdx, hasNext, onVersionSelect],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {isViewingOld && (
        <HistoricalVersionBanner
          version={viewingVersion}
          onReturnToLatest={() => { versions[0] && onVersionSelect?.(versions[0]); }}
          onRestoreVersion={onRestoreVersion}
          canRevert={canRevert}
          isReturning={isReturning}
          onPrevious={handlePrevious}
          onNext={handleNext}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
        />
      )}
      {/* Always render children so Puck's iframe loads and the canvas reaches
          the --ready state (making _PuckCanvas-root visible). Without this,
          the root stays at opacity:0 and our overlay would be invisible too,
          while the Puck spinner (a sibling outside our wrapper) shows. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          style={{
            height: '100%',
            opacity: isReturning ? 0.5 : 1,
            transition: 'opacity 120ms ease',
            pointerEvents: isReturning ? 'none' : undefined,
          }}
        >
          {children}
        </div>
        {!hasOrIsLoadingDocument && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              color: 'var(--pds-color-text-subtle)',
              backgroundColor: 'var(--pds-color-bg-default, white)',
            }}
          >
            <Icon iconName="userAstronaut" size="3xl" aria-hidden="true" />
            <p style={{ margin: 0, fontFamily: 'Poppins, sans-serif', fontSize: '1rem' }}>
              Choose a page from the menu above
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
