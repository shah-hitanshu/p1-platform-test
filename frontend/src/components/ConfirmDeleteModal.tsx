/**
 * Confirm Delete Modal
 *
 * A modal that requires users to type the name of the resource
 * to confirm deletion. Used for destructive operations.
 */

import { useState } from 'react';
import {
  Modal,
  Button,
  InlineMessage,
  TextInput,
} from '@pantheon-systems/pds-toolkit-react';
import './ConfirmDeleteModal.css';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  resourceType: 'site' | 'branch' | 'document' | 'merge request' | 'user' | 'collaborator' | 'token' | 'agent' | 'agent role' | 'origin';
  resourceName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
  error?: string | null;
}

export function ConfirmDeleteModal({
  isOpen,
  resourceType,
  resourceName,
  onConfirm,
  onCancel,
  isDeleting = false,
  error = null,
}: ConfirmDeleteModalProps) {
  const [confirmText, setConfirmText] = useState('');

  // Confirmation text is reset in handleClose, which is called via setModalIsOpen

  const isConfirmValid = confirmText === resourceName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConfirmValid && !isDeleting) {
      onConfirm();
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setConfirmText('');
      onCancel();
    }
  };

  return (
    <Modal
      ariaLabel={`Delete ${resourceType} confirmation`}
      title={`Delete ${resourceType}?`}
      modalIsOpen={isOpen}
      setModalIsOpen={handleClose}
      size="sm"
    >
      <InlineMessage
        type="warning"
        title={`This will permanently delete the ${resourceType} "${resourceName}" and all associated data. This action cannot be undone.`}
        className="delete-warning-alert"
      />

      <form onSubmit={handleSubmit} className="delete-confirm-form">
        <div className="confirm-field">
          <TextInput
            id="confirm-input"
            label={`Type "${resourceName}" to confirm:`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Enter "${resourceName}" to confirm`}
            disabled={isDeleting}
            data-testid="confirm-input"
          />
        </div>

        {error && (
          <InlineMessage type="critical" title={error} className="delete-error-alert" data-testid="modal-error" />
        )}

        <div className="modal-actions pds-modal__button-group">
          <Button
            variant="subtle"
            label="Cancel"
            onClick={handleClose.bind(null, false)}
            disabled={isDeleting}
            data-testid="cancel-button"
          />
          <Button
            variant="critical"
            buttonType="submit"
            label={isDeleting ? 'Deleting...' : `Delete ${resourceType}`}
            onClick={() => {}}
            disabled={!isConfirmValid || isDeleting}
            isLoading={isDeleting}
            data-testid="delete-button"
          />
        </div>
      </form>
    </Modal>
  );
}
