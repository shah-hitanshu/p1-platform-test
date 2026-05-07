import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import type { DocumentVersion } from '@pantheon-systems/css-client';
import { useCSSPuck } from '../../core/CSSPuckContext.js';
import { WarningTriangleIcon } from '../icons/WarningTriangleIcon.js';

export interface VersionBannerOverrideProps {
  children: React.ReactNode;
  versions: DocumentVersion[];
  selectedVersionId?: string;
  onVersionSelect?: (version: DocumentVersion) => void;
}

export function VersionBannerOverride({
  children,
  versions,
  selectedVersionId,
  onVersionSelect,
}: VersionBannerOverrideProps): React.ReactElement {
  const cssContext = useCSSPuck();
  const isViewingOld = !!selectedVersionId && versions.length > 0 && selectedVersionId !== versions[0]?.id;
  const hasDocument = cssContext.currentDocument !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {isViewingOld && (
        <div className="pds-section-message pds-section-message--warning" role="status" style={{ borderRadius: 0, flexShrink: 0 }}>
          <div className="pds-section-message__content">
            <div className="pds-section-message__icon">
              <WarningTriangleIcon />
            </div>
            <div className="pds-section-message__text">
              <div className="pds-section-message__message">
                <p>Viewing a previous version</p>
              </div>
            </div>
          </div>
          <div className="pds-section-message__actions">
            <button
              type="button"
              className="pds-button pds-button--sm pds-button--secondary pds-section-message__cta"
              onClick={() => versions[0] && onVersionSelect?.(versions[0])}
            >
              Return to current
            </button>
          </div>
        </div>
      )}
      {/* Always render children so Puck's iframe loads and the canvas reaches
          the --ready state (making _PuckCanvas-root visible). Without this,
          the root stays at opacity:0 and our overlay would be invisible too,
          while the Puck spinner (a sibling outside our wrapper) shows. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {children}
        {!hasDocument && (
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
              backgroundColor: 'white',
            }}
          >
            <Icon iconName="userAstronaut" iconSize={'3xl' as never} aria-hidden="true" />
            <p style={{ margin: 0, fontFamily: 'Poppins, sans-serif', fontSize: '1rem' }}>
              Choose a page from the menu above
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
