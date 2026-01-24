/**
 * Confirm Delete Modal
 *
 * A modal that requires users to type the name of the resource
 * to confirm deletion. Used for destructive operations.
 */

import { useState } from 'react';
import './ConfirmDeleteModal.css';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  resourceType: 'site' | 'branch' | 'document' | 'merge request';
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

  if (!isOpen) return null;

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
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Delete {resourceType}?</h2>
          <button className="modal-close" onClick={handleClose}>
            &times;
          </button>
        </div>

        <div className="modal-body">
          <div className="warning-banner">
            <span className="warning-icon">!</span>
            <div className="warning-text">
              <strong>This action cannot be undone.</strong>
              <p>
                This will permanently delete the {resourceType}{' '}
                <code>{resourceName}</code> and all associated data.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="confirm-label">
              Type <code>{resourceName}</code> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="confirm-input"
              placeholder={`Enter "${resourceName}" to confirm`}
              autoFocus
              disabled={isDeleting}
            />

            {error && (
              <div className="modal-error">
                <span className="error-icon">!</span>
                <span className="error-text">{error}</span>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={handleClose}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="delete-btn"
                disabled={!isConfirmValid || isDeleting}
              >
                {isDeleting ? 'Deleting...' : `Delete ${resourceType}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
