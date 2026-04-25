/**
 * AgentActionModal Component
 *
 * Modal for selecting an agent and configuring an action.
 * Shows agent list, intent input, region selection.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { RegisteredAgent } from '@pantheon/css-client';
import { usePresenceContext } from '../../PresenceContext.js';

export interface AgentActionModalProps {
  /** Whether modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Available agents */
  agents: RegisteredAgent[];
  /** Pre-selected target regions */
  targetRegions?: string[];
  /** Success callback */
  onSuccess?: (checkpointId?: string) => void;
  /** Error callback */
  onError?: (error: string) => void;
}

const baseClass = 'css-puck-agent-modal';

/**
 * Modal for selecting an agent and configuring an action.
 * Shows agent list, intent input, region selection.
 */
export function AgentActionModal({
  isOpen,
  onClose,
  agents,
  targetRegions = [],
  onSuccess,
  onError,
}: AgentActionModalProps): React.JSX.Element | null {
  const context = usePresenceContext();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    agents[0]?.id ?? null
  );
  const [intent, setIntent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedAgentId(agents[0]?.id ?? null);
      setIntent('');
      setIsSubmitting(false);
    }
  }, [isOpen, agents]);

  const handleAgentSelect = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
  }, []);

  const handleIntentChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIntent(e.target.value);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedAgentId || !intent.trim() || !context.documentPath || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Check if agent can edit
      const permission = await context.client.agentEdit.canEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        {
          agentId: selectedAgentId,
          trigger: 'human_requested',
          intent: intent.trim(),
          targetRegions,
          requestedById: context.userId,
        }
      );

      if (!permission.allowed) {
        setIsSubmitting(false);
        onError?.(permission.reason || 'Permission denied');
        return;
      }

      // Start the edit session
      const session = await context.client.agentEdit.startEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        {
          agentId: selectedAgentId,
          trigger: 'human_requested',
          intent: intent.trim(),
          targetRegions,
          requestedById: context.userId,
        }
      );

      setIsSubmitting(false);
      onSuccess?.(session.checkpointId);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      onError?.(errorMessage);
    }
  }, [selectedAgentId, intent, targetRegions, context, isSubmitting, onSuccess, onError, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const isSubmitDisabled = !selectedAgentId || !intent.trim() || isSubmitting;

  if (!isOpen) {
    return null;
  }

  return (
    <div className={baseClass} role="dialog" aria-modal="true" aria-labelledby={`${baseClass}-title`}>
      <div className={`${baseClass}__overlay`} onClick={handleCancel} />
      <div className={`${baseClass}__content`}>
        <h2 id={`${baseClass}-title`} className={`${baseClass}__title`}>
          Run Agent
        </h2>

        <div className={`${baseClass}__agents`}>
          <label className={`${baseClass}__label`}>Select Agent</label>
          <div className={`${baseClass}__agent-list`}>
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={[
                  `${baseClass}__agent-item`,
                  selectedAgentId === agent.id && `${baseClass}__agent-item--selected`,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleAgentSelect(agent.id)}
              >
                <span className={`${baseClass}__agent-name`}>{agent.name}</span>
                {agent.description && (
                  <span className={`${baseClass}__agent-desc`}>{agent.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className={`${baseClass}__intent`}>
          <label htmlFor={`${baseClass}-intent`} className={`${baseClass}__label`}>
            Intent
          </label>
          <input
            id={`${baseClass}-intent`}
            type="text"
            className={`${baseClass}__input`}
            value={intent}
            onChange={handleIntentChange}
            placeholder="What should the agent do?"
          />
        </div>

        {targetRegions.length > 0 && (
          <div className={`${baseClass}__regions`}>
            <label className={`${baseClass}__label`}>Target Regions</label>
            <div className={`${baseClass}__region-list`}>
              {targetRegions.map((region) => (
                <span key={region} className={`${baseClass}__region`}>
                  {region}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={`${baseClass}__actions`}>
          <button
            type="button"
            className={`${baseClass}__cancel-btn`}
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${baseClass}__submit-btn`}
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            {isSubmitting ? 'Running...' : 'Run Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
