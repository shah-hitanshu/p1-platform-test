import React, { useRef } from 'react';
import { IconButton } from '@pantheon-systems/pds-toolkit-react';
import { ACCEPTED_FILE_TYPES } from '../../lib/attachments/fileRules.js';
import { visuallyHidden } from '../../lib/a11y.js';

export interface AttachButtonProps {
  onFiles: (files: File[]) => void;
}

/** Opens the file picker, and is the only standing sign that the panel takes files at all. */
export function AttachButton({ onFiles }: AttachButtonProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onFiles(Array.from(e.target.files ?? []));
    // Cleared so picking the same file twice in a row still fires a change event.
    e.target.value = '';
  };

  return (
    <>
      <IconButton
        ariaLabel="Attach a brief or an image"
        iconName="paperclip"
        size="s"
        hasTooltip={false}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        onChange={handlePicked}
        tabIndex={-1}
        aria-hidden="true"
        style={visuallyHidden}
      />
    </>
  );
}
