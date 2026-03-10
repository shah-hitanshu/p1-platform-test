/**
 * AgentActionButton Component
 *
 * Button that triggers a human-requested agent action.
 * Shows loading state and handles errors.
 */

import React, { useState, useCallback } from 'react';
import type { RegisteredAgent } from '@pantheon/css-client';
import { usePresenceContext } from '../../PresenceContext.js';

export interface AgentActionButtonProps {
  /** Agent to trigger */
  agent: RegisteredAgent;
  /** Action to perform */
  action: {
    intent: string;
    targetRegions: string[];
    operationType?: string;
  };
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Children (button content) */
  children: React.ReactNode;
  /** Custom className */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Success callback */
  onSuccess?: (checkpointId?: string) => void;
  /** Error callback */
  onError?: (error: string) => void;
}

const baseClass = 'css-puck-agent-action-btn';

/**
 * Button that triggers a human-requested agent action.
 * Shows loading state and handles errors.
 */
export function AgentActionButton({
  agent,
  action,
  variant = 'secondary',
  size = 'md',
  children,
  className,
  disabled = false,
  onSuccess,
  onError,
}: AgentActionButtonProps): JSX.Element {
  const context = usePresenceContext();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = useCallback(async () => {
    if (isLoading || disabled || !context.documentPath) {
      return;
    }

    setIsLoading(true);

    try {
      // Check if agent can edit
      const permission = await context.client.agentEdit.canEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        {
          agentId: agent.id,
          trigger: 'human_requested',
          intent: action.intent,
          targetRegions: action.targetRegions,
          requestedById: context.userId,
        }
      );

      if (!permission.allowed) {
        setIsLoading(false);
        onError?.(permission.reason || 'Permission denied');
        return;
      }

      // Start the edit session
      const session = await context.client.agentEdit.startEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        {
          agentId: agent.id,
          trigger: 'human_requested',
          intent: action.intent,
          targetRegions: action.targetRegions,
          requestedById: context.userId,
        }
      );

      setIsLoading(false);
      onSuccess?.(session.checkpointId);
    } catch (err) {
      setIsLoading(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      onError?.(errorMessage);
    }
  }, [agent, action, context, isLoading, disabled, onSuccess, onError]);

  // Map variant prop to PDS button class
  const pdsVariantMap: Record<string, string> = {
    primary: 'pds-button--primary',
    secondary: 'pds-button--secondary',
    ghost: 'pds-button--subtle',
  };
  const pdsSizeMap: Record<string, string> = {
    sm: 'pds-button--sm',
    lg: 'pds-button--lg',
  };

  const buttonClasses = [
    'pds-button',
    pdsVariantMap[variant] ?? 'pds-button--secondary',
    pdsSizeMap[size] ?? '',
    baseClass,
    isLoading && `${baseClass}--loading`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={buttonClasses}
      onClick={handleClick}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
    >
      {isLoading ? (
        <span className={`${baseClass}__spinner`} aria-hidden="true" />
      ) : null}
      <span className={`${baseClass}__content`}>{children}</span>
    </button>
  );
}
