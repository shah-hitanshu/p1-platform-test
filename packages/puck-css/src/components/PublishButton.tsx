/**
 * PublishButton Component
 *
 * Two-step button for publishing a document to the live site.
 * First click shows a confirmation prompt, second click publishes.
 */

import React, { useState, useCallback } from 'react';
import type { Checkpoint } from '@pantheon/css-client';

interface PublishButtonProps {
  /**
   * Callback to publish the current document.
   */
  onPublish: () => Promise<Checkpoint>;

  /**
   * Whether the button is disabled.
   */
  disabled?: boolean;

  /**
   * Callback when publish succeeds.
   */
  onSuccess?: (checkpoint: Checkpoint) => void;

  /**
   * Callback when publish fails.
   */
  onError?: (error: Error) => void;

  /**
   * Additional CSS class name.
   */
  className?: string;

  /**
   * Button text.
   */
  children?: React.ReactNode;
}

/**
 * Two-step publish button. First click reveals a confirmation prompt
 * warning that this publishes to the live site. Confirming triggers
 * the actual publish.
 *
 * @example
 * ```tsx
 * <PublishButton
 *   onPublish={publishDocument}
 *   onSuccess={(cp) => console.log('Published:', cp.id)}
 * >
 *   Publish
 * </PublishButton>
 * ```
 */
export function PublishButton({
  onPublish,
  disabled = false,
  onSuccess,
  onError,
  className = '',
  children = 'Publish',
}: PublishButtonProps): React.ReactElement {
  const [isPublishing, setIsPublishing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const baseClass = 'css-puck-publish-button';

  const handleConfirm = useCallback(async () => {
    setIsPublishing(true);

    try {
      const checkpoint = await onPublish();
      setShowConfirm(false);
      onSuccess?.(checkpoint);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsPublishing(false);
    }
  }, [onPublish, onSuccess, onError]);

  const handleCancel = useCallback(() => {
    setShowConfirm(false);
  }, []);

  if (showConfirm) {
    return (
      <div className={`${baseClass}__confirm ${className}`} style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}>
        <span style={{
          fontSize: '0.75rem',
          color: '#b45309',
          fontWeight: 500,
        }}>
          Publish to live site?
        </span>
        <button
          type="button"
          className={`${baseClass}__confirm-btn`}
          onClick={() => void handleConfirm()}
          disabled={isPublishing}
          style={{
            padding: '0.25rem 0.75rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            borderRadius: '0.25rem',
            border: 'none',
            background: '#059669',
            color: 'white',
            cursor: isPublishing ? 'wait' : 'pointer',
          }}
        >
          {isPublishing ? 'Publishing...' : 'Confirm'}
        </button>
        <button
          type="button"
          className={`${baseClass}__cancel-btn`}
          onClick={handleCancel}
          disabled={isPublishing}
          style={{
            padding: '0.25rem 0.75rem',
            fontSize: '0.75rem',
            borderRadius: '0.25rem',
            border: '1px solid #d1d5db',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${baseClass} ${className}`}
      onClick={() => setShowConfirm(true)}
      disabled={disabled || isPublishing}
    >
      {children}
    </button>
  );
}
