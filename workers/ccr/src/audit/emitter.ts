/**
 * Phase 7.2: Audit Emitter
 *
 * Audit event emission for tracking system actions.
 * In development, events are logged to console.
 * In production, events would be sent to the Pantheon Audit Service.
 */

/**
 * Audit event representing a system action
 */
export interface AuditEvent {
  service: 'collaborative-state';
  action: string;
  actor: {
    id: string;
    type: 'user' | 'agent' | 'guest' | 'system';
  };
  resource: {
    type: string;
    id: string;
    siteId: string;
  };
  context: Record<string, unknown>;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

/**
 * Parameters for creating an audit event (without auto-generated fields)
 */
export interface CreateAuditEventParams {
  action: string;
  actor: {
    id: string;
    type: 'user' | 'agent' | 'guest' | 'system';
  };
  resource: {
    type: string;
    id: string;
    siteId: string;
  };
  context: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}

/**
 * Interface for audit emitters
 */
export interface AuditEmitter {
  emit(event: AuditEvent): Promise<void>;
}

/**
 * Create an audit event with auto-generated fields
 */
export function createAuditEvent(params: CreateAuditEventParams): AuditEvent {
  return {
    service: 'collaborative-state',
    action: params.action,
    actor: params.actor,
    resource: params.resource,
    context: params.context,
    timestamp: new Date(),
    success: params.success,
    errorMessage: params.errorMessage,
  };
}

/**
 * Local audit emitter for development
 * Logs audit events to console
 */
export class LocalAuditEmitter implements AuditEmitter {
  emit(event: AuditEvent): Promise<void> {
    const eventJson = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    });
    console.log('[AUDIT]', eventJson);
    return Promise.resolve();
  }
}

/**
 * Pantheon audit emitter for production
 * Stub implementation - would send events to Pantheon Audit Service
 */
export class PantheonAuditEmitter implements AuditEmitter {
  emit(event: AuditEvent): Promise<void> {
    // In production, this would send the event to the Pantheon Audit Service
    // For now, just log a warning that we're in production mode
    console.warn(
      '[AUDIT] PantheonAuditEmitter is a stub. Event:',
      event.action,
      event.resource.type,
      event.resource.id,
    );
    return Promise.resolve();
  }
}

/**
 * Factory function to get the appropriate audit emitter
 */
export function getAuditEmitter(
  environment: 'development' | 'production',
): AuditEmitter {
  if (environment === 'production') {
    return new PantheonAuditEmitter();
  }
  return new LocalAuditEmitter();
}

/**
 * Common audit actions for the CCR service
 */
export const AuditActions = {
  // Branch actions
  BRANCH_CREATE: 'branch.create',
  BRANCH_UPDATE: 'branch.update',
  BRANCH_DELETE: 'branch.delete',
  BRANCH_STATUS_CHANGE: 'branch.status_change',

  // Checkpoint actions
  CHECKPOINT_CREATE: 'checkpoint.create',
  CHECKPOINT_REVERT: 'checkpoint.revert',
  CHECKPOINT_DELETE: 'checkpoint.delete',

  // Merge actions
  MERGE_CHECK: 'merge.check',
  MERGE_EXECUTE: 'merge.execute',
  MERGE_PREVIEW: 'merge.preview',

  // Merge request actions
  MERGE_REQUEST_CREATE: 'merge_request.create',
  MERGE_REQUEST_UPDATE: 'merge_request.update',
  MERGE_REQUEST_DELETE: 'merge_request.delete',
  MERGE_REQUEST_STATUS_CHANGE: 'merge_request.status_change',

  // Grant actions
  GRANT_CREATE: 'grant.create',
  GRANT_DELETE: 'grant.delete',

  // Document actions
  DOCUMENT_CREATE: 'document.create',
  DOCUMENT_UPDATE: 'document.update',
  DOCUMENT_DELETE: 'document.delete',

  // Site actions
  SITE_CREATE: 'site.create',
  SITE_UPDATE: 'site.update',
  SITE_DELETE: 'site.delete',
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
