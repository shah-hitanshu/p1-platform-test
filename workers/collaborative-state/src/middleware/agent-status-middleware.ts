/**
 * Agent Politeness System - Phase 7.2: Agent Status Check
 *
 * Resolves an agent's registry status (active / suspended / disabled) so
 * callers can reject operations by a suspended or disabled agent.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import { getAgentById } from '../services/agent-service';
import type { AgentContext } from '../services/agent-context-service';
import type { RegisteredAgent } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of agent status check.
 */
export interface AgentStatusResult {
  /** Whether the agent is allowed to proceed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  reason?: 'agent_suspended' | 'agent_disabled' | 'agent_not_found' | 'lookup_error' | 'unknown_status';
  /** Human-readable message */
  message?: string;
  /** The agent record (if found and allowed) */
  agent?: RegisteredAgent;
}

// =============================================================================
// Agent Status Check
// =============================================================================

/**
 * Check if an agent is allowed to proceed based on status.
 *
 * @param agentContext - Parsed agent context (or null if no agent headers)
 * @returns Status result indicating if allowed and reason if not
 */
export async function checkAgentStatus(
  agentContext: AgentContext | null,
): Promise<AgentStatusResult> {
  // No agent context, or context without an agent identity, means no agent restriction
  const agentId = agentContext?.agentId;
  if (agentId === undefined || agentId === '') {
    return { allowed: true };
  }

  try {
    // Look up agent in registry
    const agent = await getAgentById(agentId);

    // Agent not found
    if (agent === null) {
      return {
        allowed: false,
        reason: 'agent_not_found',
        message: `Agent with ID '${agentId}' not found in registry`,
      };
    }

    // Check agent status
    switch (agent.status) {
      case 'active':
        return {
          allowed: true,
          agent,
        };

      case 'suspended':
        // Log details server-side for auditing
        console.warn(`Agent suspended: id=${agent.id}, name=${agent.name}`);
        return {
          allowed: false,
          reason: 'agent_suspended',
          message: 'This agent is suspended and cannot start new operations',
          agent,
        };

      case 'disabled':
        // Log details server-side for auditing
        console.warn(`Agent disabled: id=${agent.id}, name=${agent.name}`);
        return {
          allowed: false,
          reason: 'agent_disabled',
          message: 'This agent is disabled and cannot perform any operations',
          agent,
        };

      default:
        // Unknown status - deny by default
        // TypeScript infers 'never' here since all known statuses are handled
        // But we still want to handle unknown values for safety
        console.warn(`Agent unknown status: id=${agent.id}, name=${agent.name}, status=${String(agent.status)}`);
        return {
          allowed: false,
          reason: 'unknown_status',
          message: 'This agent cannot proceed due to an unknown status',
          agent,
        };
    }
  } catch (error) {
    console.error('Error looking up agent:', error);
    return {
      allowed: false,
      reason: 'lookup_error',
      message: 'An error occurred while checking agent status',
    };
  }
}

