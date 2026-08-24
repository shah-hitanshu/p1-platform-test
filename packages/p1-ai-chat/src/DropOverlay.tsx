import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { MAX_ATTACHMENTS } from './attachments.js';

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'var(--pds-color-surface-default)',
  opacity: 0.97,
  // The panel underneath owns the drag counter, and a pointer target here would fire its own
  // enter/leave as the cursor crossed it.
  pointerEvents: 'none',
};

const frameStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  height: '100%',
  justifyContent: 'center',
  borderRadius: 8,
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: 'var(--pds-color-status-info-border)',
  color: 'var(--pds-color-foreground-default)',
  textAlign: 'center',
};

/** Covers the panel while a file is over it, so the whole rail reads as one drop target. */
export function DropOverlay(): React.ReactElement {
  return (
    <div style={overlayStyle} data-testid="chat-drop-overlay">
      <div style={frameStyle}>
        <Icon iconName="upload" size="l" />
        <div style={{ fontSize: 'var(--pds-typography-size-s)', fontWeight: 'var(--pds-typography-fw-semibold)' }}>
          Drop to attach
        </div>
        <div
          style={{
            fontSize: 'var(--pds-typography-size-xs)',
            color: 'var(--pds-color-foreground-default-secondary)',
            maxWidth: 220,
          }}
        >
          Briefs and documents are read as text, images are read by looking at them. Up to{' '}
          {MAX_ATTACHMENTS} files.
        </div>
      </div>
    </div>
  );
}
