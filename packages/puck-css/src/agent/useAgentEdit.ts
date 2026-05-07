/**
 * useAgentEdit Hook
 *
 * Manages agent edit sessions for a specific agent.
 * Provides methods to check permissions, start, complete, and abort edits.
 */

import { useState, useCallback } from 'react';
import { usePresenceContext } from '../core/PresenceContext.js';
import type {
  AgentEditPermission,
  AgentEditSession,
  AgentTrigger,
} from '@pantheon-systems/css-client';

/**
 * Parameters for starting or checking an edit.
 */
export interface AgentEditParams {
  /** Trigger type */
  trigger: AgentTrigger;
  /** Intent description */
  intent: string;
  /** Target regions to edit */
  targetRegions: string[];
  /** User who requested the edit (for human_requested trigger) */
  requestedById?: string;
}

/**
 * Options for useAgentEdit hook.
 */
export interface UseAgentEditOptions {
  /** Agent ID to use for operations */
  agentId: string;
  /** Callback when edit permission is denied */
  onDenied?: (reason: string, conflictingRegions?: string[]) => void;
  /** Callback when edit completes successfully */
  onComplete?: (checkpointId: string) => void;
  /** Callback when edit is aborted */
  onAborted?: () => void;
}

/**
 * Return value of useAgentEdit hook.
 */
export interface UseAgentEditReturn {
  /** Check if agent can edit specified regions */
  canEdit: (params: AgentEditParams) => Promise<AgentEditPermission>;
  /** Start an edit session */
  startEdit: (params: AgentEditParams) => Promise<AgentEditSession>;
  /** Complete the current edit session */
  completeEdit: () => Promise<void>;
  /** Abort the current edit session */
  abortEdit: () => Promise<void>;
  /** Current session info */
  session: AgentEditSession | null;
  /**
   * Current session ID for agent authorization.
   * Convenience property - same as session?.sessionId ?? null.
   * Use this to pass to realtime client or REST API calls.
   */
  sessionId: string | null;
  /** Whether an edit session is active */
  isEditing: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Hook for managing agent edit sessions.
 *
 * @param options - Hook options including agentId and callbacks
 * @returns Methods and state for managing agent edits
 */
export function useAgentEdit(options: UseAgentEditOptions): UseAgentEditReturn {
  const { agentId, onDenied, onComplete, onAborted } = options;
  const context = usePresenceContext();

  const [session, setSession] = useState<AgentEditSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const canEdit = useCallback(
    async (params: AgentEditParams): Promise<AgentEditPermission> => {
      if (!context.documentPath) {
        throw new Error('No document path in context');
      }

      const permission = await context.client.agentEdit.canEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        {
          agentId,
          trigger: params.trigger,
          intent: params.intent,
          targetRegions: params.targetRegions,
          requestedById: params.requestedById,
        }
      );

      if (!permission.allowed && onDenied && permission.reason) {
        onDenied(permission.reason, permission.conflictingRegions);
      }

      return permission;
    },
    [context, agentId, onDenied]
  );

  const startEdit = useCallback(
    async (params: AgentEditParams): Promise<AgentEditSession> => {
      if (!context.documentPath) {
        throw new Error('No document path in context');
      }

      setIsLoading(true);
      setError(null);

      try {
        const newSession = await context.client.agentEdit.startEdit(
          context.siteId,
          context.branchId,
          context.documentPath,
          {
            agentId,
            trigger: params.trigger,
            intent: params.intent,
            targetRegions: params.targetRegions,
            requestedById: params.requestedById,
          }
        );

        setSession(newSession);
        setIsLoading(false);
        return newSession;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setIsLoading(false);
        throw e;
      }
    },
    [context, agentId]
  );

  const completeEdit = useCallback(async (): Promise<void> => {
    if (!session) {
      throw new Error('No active edit session');
    }

    if (!context.documentPath) {
      throw new Error('No document path in context');
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await context.client.agentEdit.completeEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        agentId
      );

      setSession(null);
      setIsLoading(false);

      if (onComplete && result.checkpointId) {
        onComplete(result.checkpointId);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setIsLoading(false);
      throw e;
    }
  }, [session, context, agentId, onComplete]);

  const abortEdit = useCallback(async (): Promise<void> => {
    if (!session) {
      throw new Error('No active edit session');
    }

    if (!context.documentPath) {
      throw new Error('No document path in context');
    }

    if (!session.checkpointId) {
      throw new Error('No checkpoint ID in session');
    }

    setIsLoading(true);
    setError(null);

    try {
      await context.client.agentEdit.abortEdit(
        context.siteId,
        context.branchId,
        context.documentPath,
        agentId,
        session.checkpointId
      );

      setSession(null);
      setIsLoading(false);

      if (onAborted) {
        onAborted();
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setIsLoading(false);
      throw e;
    }
  }, [session, context, agentId, onAborted]);

  return {
    canEdit,
    startEdit,
    completeEdit,
    abortEdit,
    session,
    sessionId: session?.sessionId ?? null,
    isEditing: session !== null,
    isLoading,
    error,
  };
}
