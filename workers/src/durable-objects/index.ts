/**
 * Durable Objects
 *
 * Exports for Durable Objects required by wrangler.jsonc.
 * DocumentState is the real implementation (aliased from DocumentSession for wrangler compatibility).
 * PresenceManager and SessionManager are placeholders for future phases.
 */

import type { DurableObjectState } from '@cloudflare/workers-types';

// Re-export DocumentSession as DocumentState for wrangler.jsonc compatibility
// The wrangler config expects class_name: "DocumentState"
export { DocumentSession } from './document-session';
export { DocumentSession as DocumentState } from './document-session';

/**
 * PresenceManager - Tracks user presence and cursors.
 * Placeholder implementation for infrastructure validation.
 */
export class PresenceManager {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  fetch(_request: Request): Response {
    return new Response(
      JSON.stringify({
        error: 'Not Implemented',
        message: 'PresenceManager Durable Object is not yet implemented',
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

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
