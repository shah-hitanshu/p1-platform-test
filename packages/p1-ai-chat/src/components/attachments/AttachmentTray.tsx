import React from 'react';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import type { PendingAttachment } from '../../types.js';
import { cardStyle, FileCardFace } from './FileCard.js';

export interface AttachmentTrayProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  /** Show a file that has finished reading, in the view the transcript opens. */
  onOpen: (attachment: PendingAttachment) => void;
}

const faceButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const removeStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 1,
  top: 2,
  right: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--pds-color-surface-default)',
  color: 'var(--pds-color-foreground-default-secondary)',
  cursor: 'pointer',
};

const errorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  marginBottom: 8,
  fontSize: 'var(--pds-typography-size-2xs)',
  color: 'var(--pds-color-status-critical-foreground)',
};

const dismissStyle: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const truncationNoticeStyle: React.CSSProperties = {
  marginBottom: 8,
  fontSize: 'var(--pds-typography-size-2xs)',
  color: 'var(--pds-color-foreground-default-secondary)',
};

function AttachmentCard({
  attachment,
  onRemove,
  onOpen,
}: {
  attachment: PendingAttachment;
  onRemove: (id: string) => void;
  onOpen: (attachment: PendingAttachment) => void;
}): React.ReactElement {
  return (
    <div style={cardStyle}>
      {/* The face is the button, not the card: the remove control sits on top of it, and a
          button inside a button is not valid HTML. */}
      <button
        type="button"
        style={faceButtonStyle}
        aria-label={`Open ${attachment.filename}`}
        title={attachment.filename}
        onClick={() => onOpen(attachment)}
        disabled={attachment.status === 'pending'}
      >
        <FileCardFace
          kind={attachment.kind}
          filename={attachment.filename}
          dataUrl={attachment.dataUrl}
          isPending={attachment.status === 'pending'}
        />
      </button>
      <button
        type="button"
        style={removeStyle}
        aria-label={`Remove ${attachment.filename}`}
        onClick={() => onRemove(attachment.id)}
      >
        <Icon iconName="xmark" size="s" />
      </button>
    </div>
  );
}

function CarriedAttachments({
  attachments,
  onRemove,
  onOpen,
}: AttachmentTrayProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {attachments.map(attachment => (
        <AttachmentCard key={attachment.id} attachment={attachment} onRemove={onRemove} onOpen={onOpen} />
      ))}
    </div>
  );
}

function FailedAttachments({
  attachments,
  onDismiss,
}: {
  attachments: PendingAttachment[];
  onDismiss: (id: string) => void;
}): React.ReactElement {
  return (
    <>
      {attachments.map(attachment => (
        <div key={attachment.id} style={errorRowStyle}>
          <Icon iconName="circleExclamation" size="s" />
          <span style={{ flex: 1, minWidth: 0 }}>
            {attachment.filename} — {attachment.error}
          </span>
          <button
            type="button"
            style={dismissStyle}
            aria-label={`Dismiss ${attachment.filename}`}
            onClick={() => onDismiss(attachment.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </>
  );
}

function TruncationNotices({ attachments }: { attachments: PendingAttachment[] }): React.ReactElement {
  return (
    <>
      {attachments.map(attachment => (
        <div key={attachment.id} style={truncationNoticeStyle}>
          {attachment.filename} is long, so only its first part will be sent.
        </div>
      ))}
    </>
  );
}

/** The files on the composer, as cards above the message box. Nothing until one arrives. */
export function AttachmentTray({ attachments, onRemove, onOpen }: AttachmentTrayProps): React.ReactElement | null {
  if (attachments.length === 0) return null;

  const carried = attachments.filter(a => a.status !== 'error');
  const failed = attachments.filter(a => a.status === 'error');
  const truncated = attachments.filter(a => a.truncated === true);

  return (
    <div>
      {carried.length > 0 && (
        <CarriedAttachments attachments={carried} onRemove={onRemove} onOpen={onOpen} />
      )}
      {failed.length > 0 && <FailedAttachments attachments={failed} onDismiss={onRemove} />}
      {truncated.length > 0 && <TruncationNotices attachments={truncated} />}
    </div>
  );
}
