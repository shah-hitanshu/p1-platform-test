/**
 * Confirm Delete Modal
 *
 * A modal that requires users to type the name of the resource
 * to confirm deletion. Used for destructive operations.
 */

import { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalContent,
  Button,
  Alert,
} from '@pantheon-systems/design-toolkit-react';
import './ConfirmDeleteModal.css';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  resourceType: 'site' | 'branch' | 'document' | 'merge request' | 'user' | 'collaborator' | 'token';
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

  // Confirmation text is reset in handleClose, which is called via onDismiss

  const isConfirmValid = confirmText === resourceName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConfirmValid && !isDeleting) {
      onConfirm();
    }
  };

  const handleClose = () => {
    setConfirmText('');
    onCancel();
  };

  return (
    <Modal
      ariaLabel={`Delete ${resourceType} confirmation`}
      isOpen={isOpen}
      onDismiss={handleClose}
      size="small"
    >
      <ModalHeader title={`Delete ${resourceType}?`} />

      <ModalContent>
        <Alert type="warning" className="delete-warning-alert">
          <strong>This action cannot be undone.</strong>
          <p>
            This will permanently delete the {resourceType}{' '}
            <code>{resourceName}</code> and all associated data.
          </p>
        </Alert>

        <form onSubmit={handleSubmit} className="delete-confirm-form">
          <div className="confirm-field">
            <label htmlFor="confirm-input" className="confirm-label">
              Type <code>{resourceName}</code> to confirm:
            </label>
            <input
              type="text"
              id="confirm-input"
              className="pds-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Enter "${resourceName}" to confirm`}
              disabled={isDeleting}
              data-testid="confirm-input"
            />
          </div>

          {error && (
            <Alert type="danger" className="delete-error-alert" data-testid="modal-error">
              {error}
            </Alert>
          )}

          <div className="modal-actions">
            <Button
              type="secondary"
              onClick={handleClose}
              disabled={isDeleting}
              data-testid="cancel-button"
            >
              Cancel
            </Button>
            <Button
              type="danger"
              isSubmit
              onClick={() => {}}
              disabled={!isConfirmValid || isDeleting}
              isLoading={isDeleting}
              data-testid="delete-button"
            >
              {isDeleting ? 'Deleting...' : `Delete ${resourceType}`}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
