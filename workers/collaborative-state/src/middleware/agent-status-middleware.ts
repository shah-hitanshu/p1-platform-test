/**
 * Agent Politeness System - Phase 7.2: Agent Status Middleware
 *
 * Middleware that validates agent status before allowing operations.
 * When X-Agent-Id header is present, looks up agent in registry and
 * rejects requests if agent is suspended or disabled.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import { getAgentById } from '../services/agent-service';
import { parseAgentContext, type AgentContext } from '../services/agent-context-service';
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

/**
 * Middleware function type.
 */
export type MiddlewareFunction = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

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
  // No agent context means no agent restriction
  if (agentContext === null) {
    return { allowed: true };
  }

  try {
    // Look up agent in registry
    const agent = await getAgentById(agentContext.agentId);

    // Agent not found
    if (agent === null) {
      return {
        allowed: false,
        reason: 'agent_not_found',
        message: `Agent with ID '${agentContext.agentId}' not found in registry`,
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

// =============================================================================
// Header Parsing Helper
// =============================================================================

/**
 * Parse agent context from request headers.
 * Re-exports from agent-context-service for convenience.
 *
 * @param request - The HTTP request
 * @returns Parsed agent context or null
 */
export function parseAgentHeaders(request: Request): AgentContext | null {
  return parseAgentContext(request.headers);
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create middleware that checks agent status on requests.
 *
 * When X-Agent-Id header is present:
 * - Looks up agent in registry
 * - Returns 403 if agent is suspended
 * - Returns 403 if agent is disabled
 * - Returns 404 if agent not found
 * - Returns 500 on database error
 *
 * When no agent headers are present, passes through.
 *
 * @returns Middleware function
 */
export function createAgentStatusMiddleware(): MiddlewareFunction {
  return async (request: Request, next: () => Promise<Response>): Promise<Response> => {
    // Parse agent context from headers
    const agentContext = parseAgentHeaders(request);

    // No agent headers - pass through
    if (agentContext === null) {
      return next();
    }

    // Check agent status
    const result = await checkAgentStatus(agentContext);

    // Allowed - pass through
    if (result.allowed) {
      return next();
    }

    // Build error response based on reason
    let status: number;
    switch (result.reason) {
      case 'agent_not_found':
        status = 404;
        break;
      case 'agent_suspended':
      case 'agent_disabled':
        status = 403;
        break;
      case 'lookup_error':
      default:
        status = 500;
        break;
    }

    const errorMessage = result.message !== undefined && result.message !== ''
      ? result.message
      : 'Agent access denied';

    return new Response(
      JSON.stringify({
        error: errorMessage,
        reason: result.reason,
      }),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  };
}
