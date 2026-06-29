/**
 * Durable Objects
 *
 * Exports for Durable Objects required by wrangler.jsonc.
 * DocumentState is the real implementation (aliased from DocumentSession for wrangler compatibility).
 * PresenceManager is the site-level presence aggregator (Phase 3.2).
 * SessionManager is a placeholder for future phases.
 */


// Re-export DocumentSession as DocumentState for wrangler.jsonc compatibility
// The wrangler config expects class_name: "DocumentState"
export { DocumentSession } from './document-session';
export { DocumentSession as DocumentState } from './document-session';

// Phase 3.2: Real PresenceManager DO implementation
export { PresenceManager } from './presence-manager';

// Broker authentication transactions
export { BrokerTransaction } from './broker-transaction';

/**
 * SessionManager - Manages user sessions and authentication.
 * Placeholder implementation for infrastructure validation.
 */
export class SessionManager {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  fetch(_request: Request): Response {
    return new Response(
      JSON.stringify({
        error: 'Not Implemented',
        message: 'SessionManager Durable Object is not yet implemented',
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
