/**
 * Agent Politeness System - Phase 7.1: Agent Context Parser
 *
 * Parses and validates X-Agent-* headers from API requests.
 * Agents provide context via headers per the architecture specification:
 *
 * - X-Agent-Id: <agent-uuid>
 * - X-Agent-Trigger: human_requested | autonomous
 * - X-Agent-Requested-By: <user-uuid> (when human_requested)
 * - X-Agent-Intent: <description of what agent is doing>
 * - X-Agent-Operation-Type: <category>
 * - X-Agent-Target-Regions: <comma-separated JSON paths>
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

import {
  MAX_ACTOR_ID_LENGTH,
  MAX_INTENT_LENGTH,
  MAX_OPERATION_TYPE_LENGTH,
  MAX_TARGET_REGIONS,
  MAX_REGION_PATH_LENGTH,
} from '../constants/security-limits';

// Re-export for backwards compatibility (using alias for agent-specific naming)
export { MAX_INTENT_LENGTH, MAX_OPERATION_TYPE_LENGTH, MAX_TARGET_REGIONS, MAX_REGION_PATH_LENGTH };
export { MAX_ACTOR_ID_LENGTH as MAX_AGENT_ID_LENGTH };

/** Valid characters for agent ID (alphanumeric, hyphens, underscores) */
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Valid trigger values */
const VALID_TRIGGERS = ['human_requested', 'autonomous'] as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed agent context from request headers.
 */
export interface AgentContext {
  /** Agent UUID from X-Agent-Id header */
  agentId: string;
  /** Trigger type from X-Agent-Trigger header */
  trigger?: 'human_requested' | 'autonomous';
  /** User who requested the work (for human_requested trigger) */
  requestedById?: string;
  /** Description of what the agent is doing */
  intent?: string;
  /** Category of operation being performed */
  operationType?: string;
  /** JSON paths the agent intends to work on */
  targetRegions?: string[];
}

/**
 * Result of agent context validation.
 */
export interface AgentContextValidationResult {
  /** Whether the context is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
}

// =============================================================================
// Header Parsing
// =============================================================================

/**
 * Check if request headers contain agent context.
 *
 * @param headers - Request headers
 * @returns True if X-Agent-Id header is present
 */
export function hasAgentContext(headers: Headers): boolean {
  return headers.has('X-Agent-Id') || headers.has('x-agent-id');
}

/**
 * Get header value with case-insensitive fallback.
 */
function getHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (value !== null) {
    return value;
  }
  return headers.get(name.toLowerCase());
}

/**
 * Parse agent context from request headers.
 *
 * Headers are case-insensitive per HTTP spec. Returns null if no
 * X-Agent-Id header is present (no agent context).
 *
 * @param headers - Request headers
 * @returns Parsed agent context or null if no agent headers
 */
export function parseAgentContext(headers: Headers): AgentContext | null {
  // Check for X-Agent-Id header (required for agent context)
  const agentId = getHeader(headers, 'X-Agent-Id');
  if (agentId === null || agentId === '') {
    return null;
  }

  // Parse trigger - validate before casting
  const triggerValue = getHeader(headers, 'X-Agent-Trigger');
  let trigger: 'human_requested' | 'autonomous' | undefined;
  if (triggerValue !== null) {
    if (VALID_TRIGGERS.includes(triggerValue as 'human_requested' | 'autonomous')) {
      trigger = triggerValue as 'human_requested' | 'autonomous';
    }
    // Invalid trigger values are left as undefined - will be caught by validation
  }

  // Parse requestedById (for human_requested trigger)
  const requestedById = getHeader(headers, 'X-Agent-Requested-By') ?? undefined;

  // Parse intent
  const intent = getHeader(headers, 'X-Agent-Intent') ?? undefined;

  // Parse operation type
  const operationType = getHeader(headers, 'X-Agent-Operation-Type') ?? undefined;

  // Parse target regions (comma-separated)
  const targetRegionsValue = getHeader(headers, 'X-Agent-Target-Regions');
  let targetRegions: string[] | undefined;
  if (targetRegionsValue !== null) {
    if (targetRegionsValue.trim() === '') {
      targetRegions = [];
    } else {
      targetRegions = targetRegionsValue
        .split(',')
        .map((region) => region.trim())
        .filter((region) => region.length > 0);
    }
  }

  return {
    agentId,
    trigger,
    requestedById,
    intent,
    operationType,
    targetRegions,
  };
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate agent context fields.
 *
 * Checks:
 * - agentId is required and valid format
 * - trigger is valid enum value
 * - requestedById is required when trigger is human_requested
 * - intent and operationType are within length limits
 * - targetRegions count and path lengths are within limits
 *
 * @param context - Agent context to validate
 * @returns Validation result with errors array
 */
export function validateAgentContext(context: Partial<AgentContext>): AgentContextValidationResult {
  const errors: string[] = [];

  // Validate agentId
  if (context.agentId === undefined || context.agentId.trim() === '') {
    errors.push('agentId is required');
  } else {
    if (context.agentId.length > MAX_ACTOR_ID_LENGTH) {
      errors.push(`agentId exceeds maximum length of ${String(MAX_ACTOR_ID_LENGTH)}`);
    }
    if (!AGENT_ID_PATTERN.test(context.agentId)) {
      errors.push('agentId contains invalid characters');
    }
  }

  // Validate trigger
  if (context.trigger !== undefined) {
    const triggerIsValid = VALID_TRIGGERS.includes(context.trigger);
    if (!triggerIsValid) {
      errors.push('trigger must be "human_requested" or "autonomous"');
    }
  }

  // Validate requestedById (required when trigger is human_requested)
  if (context.trigger === 'human_requested') {
    if (context.requestedById === undefined || context.requestedById.trim() === '') {
      errors.push('requestedById is required when trigger is human_requested');
    }
  }

  // Validate intent
  if (context.intent !== undefined && context.intent.length > MAX_INTENT_LENGTH) {
    errors.push(`intent exceeds maximum length of ${String(MAX_INTENT_LENGTH)}`);
  }

  // Validate operationType
  if (context.operationType !== undefined && context.operationType.length > MAX_OPERATION_TYPE_LENGTH) {
    errors.push(`operationType exceeds maximum length of ${String(MAX_OPERATION_TYPE_LENGTH)}`);
  }

  // Validate targetRegions
  if (context.targetRegions !== undefined) {
    if (context.targetRegions.length > MAX_TARGET_REGIONS) {
      errors.push(`targetRegions exceeds maximum count of ${String(MAX_TARGET_REGIONS)}`);
    }
    for (const region of context.targetRegions) {
      if (region.length > MAX_REGION_PATH_LENGTH) {
        errors.push(`targetRegion path exceeds maximum length of ${String(MAX_REGION_PATH_LENGTH)}`);
        break; // Only report first violation
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
