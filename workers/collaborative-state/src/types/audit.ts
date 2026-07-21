/**
 * Collaborative State System - Audit Event Types
 */

// =============================================================================
// Audit Types
// =============================================================================

/**
 * Actor information for audit events.
 */
export interface AuditActor {
  id: string;
  type: 'user' | 'agent' | 'guest' | 'system';
}

/**
 * Resource information for audit events.
 */
export interface AuditResource {
  type: string;
  id: string;
  siteId: string;
}

/**
 * Records significant system actions for audit logging.
 */
export interface AuditEvent {
  service: 'collaborative-state';
  action: string;
  actor: AuditActor;
  resource: AuditResource;
  context: Record<string, unknown>;
  timestamp: string;
  success: boolean;
  errorMessage?: string;
}
