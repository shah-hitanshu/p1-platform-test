/**
 * PublishButton Component
 *
 * Button for creating checkpoints (publishing).
 */

import React, { useState, useCallback } from 'react';
import type { Checkpoint } from '@pantheon/css-client';

interface PublishButtonProps {
  /**
   * Callback to create checkpoint.
   */
  onPublish: (name?: string) => Promise<Checkpoint>;

  /**
   * Whether the button is disabled.
   */
  disabled?: boolean;

  /**
   * Whether to show a name input prompt.
   */
  showNamePrompt?: boolean;

  /**
   * Callback when publish succeeds.
   */
  onSuccess?: (checkpoint: Checkpoint) => void;

  /**
   * Callback when publish fails.
   */
  onError?: (error: Error) => void;

  /**
   * Callback when the name prompt is shown. Use this to pause auto-save
   * and prevent refresh interference while typing.
   */
  onPromptShow?: () => void;

  /**
   * Callback when the name prompt is dismissed (after publish or cancel).
   * Note: Auto-save typically resumes on the next edit, not on prompt close.
   */
  onPromptClose?: () => void;

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
 * Button component for publishing (creating checkpoints).
 *
 * @example
 * ```tsx
 * <PublishButton
 *   onPublish={createCheckpoint}
 *   showNamePrompt
 *   onSuccess={(cp) => console.log('Published:', cp.name)}
 * >
 *   Publish
 * </PublishButton>
 * ```
 */
export function PublishButton({
  onPublish,
  disabled = false,
  showNamePrompt = true,
  onSuccess,
  onError,
  onPromptShow,
  onPromptClose,
  className = '',
  children = 'Publish',
}: PublishButtonProps): React.ReactElement {
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [checkpointName, setCheckpointName] = useState('');

  const baseClass = 'css-puck-publish-button';

  const handlePublish = useCallback(async () => {
    if (showNamePrompt && !showPrompt) {
      setShowPrompt(true);
      onPromptShow?.();
      return;
    }

    setIsPublishing(true);

    try {
      const checkpoint = await onPublish(checkpointName || undefined);
      setShowPrompt(false);
      setCheckpointName('');
      onPromptClose?.();
      onSuccess?.(checkpoint);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsPublishing(false);
    }
  }, [onPublish, showNamePrompt, showPrompt, checkpointName, onSuccess, onError, onPromptShow, onPromptClose]);

  const handleCancel = useCallback(() => {
    setShowPrompt(false);
    setCheckpointName('');
    onPromptClose?.();
  }, [onPromptClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        void handlePublish();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handlePublish, handleCancel]
  );

  if (showPrompt) {
    return (
      <div className={`${baseClass}__prompt ${className}`}>
        <input
          type="text"
          className={`${baseClass}__input`}
          placeholder="Checkpoint name (optional)"
          value={checkpointName}
          onChange={(e) => setCheckpointName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button
          type="button"
          className={`${baseClass}__confirm`}
          onClick={() => void handlePublish()}
          disabled={isPublishing}
        >
          {isPublishing ? 'Publishing...' : 'Confirm'}
        </button>
        <button
          type="button"
          className={`${baseClass}__cancel`}
          onClick={handleCancel}
          disabled={isPublishing}
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
      onClick={() => void handlePublish()}
      disabled={disabled || isPublishing}
    >
      {isPublishing ? 'Publishing...' : children}
    </button>
  );
}
