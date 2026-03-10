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
 * Button component for publishing (creating checkpoints).
 *
 * @example
 * ```tsx
 * <PublishButton
 *   onPublish={createCheckpoint}
 *   onSuccess={(cp) => console.log('Published:', cp.name)}
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

  const baseClass = 'css-puck-publish-button';

  const handlePublish = useCallback(async () => {
    setIsPublishing(true);

    try {
      const checkpoint = await onPublish();
      onSuccess?.(checkpoint);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsPublishing(false);
    }
  }, [onPublish, onSuccess, onError]);

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
