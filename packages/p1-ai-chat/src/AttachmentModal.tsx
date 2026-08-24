import React from 'react';
import { Modal } from '@pantheon-systems/pds-toolkit-react';
import type { AttachedFile } from './types.js';

export interface AttachmentModalProps {
  file: AttachedFile;
  onClose: () => void;
}

/**
 * PDS centres `.pds-modal` with `margin: auto`, but floating-ui's overlay has no flex, so the
 * vertical auto margins resolve to zero and a tall modal sits at the top of the screen.
 *
 * Modal spreads `...props` after its own `style`, so this replaces PDS's rather than merging
 * with it: its `top: 5%` and its reveal transition go too, and `contentMaxHeight` cannot be
 * used alongside it — the body below carries its own cap instead.
 */
const centredStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
};

/** A sent file at page size: the picture, or the text exactly as the agent was given it. */
export function AttachmentModal({ file, onClose }: AttachmentModalProps): React.ReactElement {
  return (
    <Modal
      title={file.filename}
      modalIsOpen
      setModalIsOpen={(isOpen: boolean) => { if (!isOpen) onClose(); }}
      hasCloseButton
      closeButtonLabel="Close preview"
      size="l"
      style={centredStyle}
    >
      <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
        {file.dataUrl !== undefined ? (
          <img
            src={file.dataUrl}
            alt={file.filename}
            style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
          />
        ) : (
          // Pre-wrapped, not rendered: formatting it would show something other than what
          // the agent was given.
          <pre style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 'var(--pds-typography-size-xs)',
            lineHeight: 1.5,
          }}>
            {file.text}
          </pre>
        )}
      </div>
    </Modal>
  );
}
