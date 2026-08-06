/**
 * useAgentTrigger Hook
 *
 * Orchestrates the full agent edit workflow for human-triggered actions.
 * Manages permission checking, session lifecycle, and action state.
 */

import { useState, useCallback, useRef } from 'react';
import type { RegisteredAgent } from '@pantheon-systems/css-client';
import { usePresenceContext } from '../core/PresenceContext.js';

/**
 * Describes an agent action to be triggered.
 */
export interface AgentAction {
  /** Agent ID to trigger */
  agentId: string;
  /** Intent description */
  intent: string;
  /** Target regions to edit */
  targetRegions: string[];
  /** Operation type (optional) */
  operationType?: string;
}

/**
 * Result of triggering an agent action.
 */
export interface AgentTriggerResult {
  /** Whether the action was successful */
  success: boolean;
  /** Checkpoint ID if successful */
  checkpointId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Status of the agent trigger workflow.
 */
export type AgentTriggerStatus =
  | 'idle'
  | 'checking'
  | 'starting'
  | 'editing'
  | 'completing'
  | 'error';

/**
 * Options for useAgentTrigger hook.
 */
export interface UseAgentTriggerOptions {
  /** List of available agents */
  agents: RegisteredAgent[];
}

/**
 * Return value of useAgentTrigger hook.
 */
export interface UseAgentTriggerReturn {
  /** Trigger a human-requested agent action */
  triggerAgent: (action: AgentAction) => Promise<AgentTriggerResult>;
  /** Currently running agent action */
  activeAction: AgentAction | null;
  /** Progress/status of current action */
  status: AgentTriggerStatus;
  /** Cancel the current agent action */
  cancelAction: () => Promise<void>;
}

/**
 * Hook for orchestrating agent edit workflows.
 *
 * Handles the full lifecycle of human-triggered agent actions:
 * 1. Check permission with canEdit
 * 2. Start session with startEdit
 * 3. Monitor for completion
 * 4. Complete or abort based on outcome
 *
 * @param options - Hook options including available agents
 * @returns Methods and state for triggering agent actions
 */
export function useAgentTrigger(
  _options: UseAgentTriggerOptions
): UseAgentTriggerReturn {
  // Note: _options.agents can be used for validation in the future
  const context = usePresenceContext();

  const [activeAction, setActiveAction] = useState<AgentAction | null>(null);
  const [status, setStatus] = useState<AgentTriggerStatus>('idle');

  // Track cancellation
  const cancelledRef = useRef(false);
  const currentSessionRef = useRef<{ sessionId: string; checkpointId?: string } | null>(null);

  const triggerAgent = useCallback(
    async (action: AgentAction): Promise<AgentTriggerResult> => {
      if (!context.documentPath) {
        return {
          success: false,
          error: 'No document path in context',
        };
      }

      // Reset cancellation flag
      cancelledRef.current = false;
      setActiveAction(action);
      setStatus('checking');

      try {
        // Step 1: Check permission
        const permission = await context.client.agentEdit.canEdit(
          context.siteId,
          context.branchId,
          context.documentPath,
          {
            agentId: action.agentId,
            trigger: 'human_requested',
            intent: action.intent,
            targetRegions: action.targetRegions,
            requestedById: context.userId,
          }
        );

        if (cancelledRef.current) {
          setActiveAction(null);
          setStatus('idle');
          return { success: false, error: 'cancelled' };
        }

        if (!permission.allowed) {
          setActiveAction(null);
          setStatus('idle');
          return {
            success: false,
            error: permission.reason,
          };
        }

        // Step 2: Start edit session
        setStatus('starting');
        const session = await context.client.agentEdit.startEdit(
          context.siteId,
          context.branchId,
          context.documentPath,
          {
            agentId: action.agentId,
            trigger: 'human_requested',
            intent: action.intent,
            targetRegions: action.targetRegions,
            requestedById: context.userId,
          }
        );

        if (cancelledRef.current) {
          // We started a session, need to abort it
          if (session.checkpointId) {
            await context.client.agentEdit.abortEdit(
              context.siteId,
              context.branchId,
              context.documentPath,
              action.agentId,
              session.checkpointId
            );
          }
          setActiveAction(null);
          setStatus('idle');
          return { success: false, error: 'cancelled' };
        }

        currentSessionRef.current = session;
        setStatus('editing');

        // For now, we consider the action complete once the session is started
        // In a full implementation, we would wait for the agent to signal completion
        // This is a simplified version that returns success immediately
        setActiveAction(null);
        setStatus('idle');
        currentSessionRef.current = null;

        return {
          success: true,
          checkpointId: session.checkpointId,
        };
      } catch (err) {
        setActiveAction(null);
        setStatus('idle');
        currentSessionRef.current = null;
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [context]
  );

  const cancelAction = useCallback(async (): Promise<void> => {
    if (!activeAction) {
      return;
    }

    cancelledRef.current = true;

    // If we have an active session, abort it
    if (currentSessionRef.current && context.documentPath) {
      const session = currentSessionRef.current;
      if (session.checkpointId) {
        try {
          await context.client.agentEdit.abortEdit(
            context.siteId,
            context.branchId,
            context.documentPath,
            activeAction.agentId,
            session.checkpointId
          );
        } catch {
          // Best effort - ignore errors during cancellation
        }
      }
    }

    setActiveAction(null);
    setStatus('idle');
    currentSessionRef.current = null;
  }, [activeAction, context]);

  return {
    triggerAgent,
    activeAction,
    status,
    cancelAction,
  };
}
