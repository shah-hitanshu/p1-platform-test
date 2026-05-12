/**
 * Presence Context
 *
 * React context for providing presence-related dependencies to hooks.
 */

import { createContext, useContext } from 'react';
import type {
  P1Client,
  ActorPresence,
  AgentEditContext,
  AgentEditPermission,
  AgentEditSession,
  AgentEditCompleteResult,
  AgentEditAbortResult,
} from '@pantheon-systems/css-client';

/**
 * Callback for subscribing to presence events.
 */
export type PresenceEventCallback = (event: unknown) => void;

/**
 * Unsubscribe function returned by subscribe.
 */
export type PresenceUnsubscribe = () => void;

/**
 * Context value for presence hooks.
 */
export interface PresenceContextValue {
  /** P1 Client instance */
  client: P1Client;
  /** Current site ID */
  siteId: string;
  /** Current branch ID */
  branchId: string;
  /** Current document path (optional, for document-level presence) */
  documentPath: string | null;
  /** Current user ID (for self-filtering) */
  userId: string;
  /** Alias for userId */
  currentUserId: string;
  /** Whether connected to the presence service */
  isConnected: boolean;
  /** Current presence list (alias for actors) */
  presence: ActorPresence[];
  /** Current actors (same as presence) */
  actors: ActorPresence[];
  /** Currently active agents */
  activeAgents: ActorPresence[];
  /** Regions being edited by agents */
  agentEditingRegions: string[];
  /** Whether any agent is currently editing */
  isAgentEditing: boolean;
  /** Check if agent can edit */
  canEdit: (context: AgentEditContext) => Promise<AgentEditPermission>;
  /** Start an agent edit session */
  startEdit: (context: AgentEditContext) => Promise<AgentEditSession>;
  /** Complete an agent edit session */
  completeEdit: (sessionId: string, description?: string) => Promise<AgentEditCompleteResult>;
  /** Abort an agent edit session */
  abortEdit: (sessionId: string) => Promise<AgentEditAbortResult>;
  /** Subscribe to presence events */
  subscribe: (callback: PresenceEventCallback) => PresenceUnsubscribe;
}

/**
 * Context for presence hook dependencies.
 */
export const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * Hook to access presence context.
 *
 * @throws Error if used outside of PresenceProvider
 * @returns Presence context value
 */
export function usePresenceContext(): PresenceContextValue {
  const context = useContext(PresenceContext);

  if (context === null) {
    throw new Error(
      'Presence hooks must be used within a PresenceProvider or P1PuckProvider'
    );
  }

  return context;
}

/**
 * Hook to optionally access presence context.
 * Returns null if not within a PresenceProvider (no error thrown).
 */
export function useOptionalPresenceContext(): PresenceContextValue | null {
  return useContext(PresenceContext);
}
