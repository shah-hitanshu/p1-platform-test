import React from 'react';

const CARD_EDGE = 72;

export const cardStyle: React.CSSProperties = {
  position: 'relative',
  flex: '0 0 auto',
  width: CARD_EDGE,
  height: CARD_EDGE,
  boxSizing: 'border-box',
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--pds-color-border-default)',
  background: 'var(--pds-color-surface-default-secondary)',
  overflow: 'hidden',
};

const nameStyle: React.CSSProperties = {
  padding: 6,
  boxSizing: 'border-box',
  height: '100%',
  overflow: 'hidden',
  fontSize: 'var(--pds-typography-size-2xs)',
  lineHeight: 1.3,
  textAlign: 'left',
  wordBreak: 'break-word',
  color: 'var(--pds-color-foreground-default)',
};

/** Keeps a long name from running under the badge, which sits over the bottom of the card. */
const documentNameStyle: React.CSSProperties = { ...nameStyle, paddingBottom: 24 };

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  left: 4,
  bottom: 4,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'var(--pds-color-surface-default)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--pds-color-border-default)',
  fontSize: 'var(--pds-typography-size-2xs)',
  fontWeight: 'var(--pds-typography-fw-semibold)',
  color: 'var(--pds-color-foreground-default-secondary)',
};

function extensionLabel(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toUpperCase() : 'FILE';
}

export interface FileCardFaceProps {
  kind: 'image' | 'document';
  filename: string;
  /** Absent while the image is still being read, and on a turn replayed from history. */
  dataUrl?: string;
  isPending?: boolean;
}

/** Shared so a file looks the same on the composer and in the turn it was sent with. */
export function FileCardFace({ kind, filename, dataUrl, isPending }: FileCardFaceProps): React.ReactElement {
  if (isPending === true) {
    return <div style={{ ...nameStyle, color: 'var(--pds-color-foreground-default-secondary)' }}>{filename}</div>;
  }
  if (kind === 'image' && dataUrl !== undefined) {
    // The filename is the alt text: the card shows the picture instead of the name.
    return (
      <img
        src={dataUrl}
        alt={filename}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return (
    <>
      <div style={documentNameStyle}>{filename}</div>
      <span style={badgeStyle}>{extensionLabel(filename)}</span>
    </>
  );
}
