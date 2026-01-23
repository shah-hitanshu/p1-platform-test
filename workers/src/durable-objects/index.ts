/**
 * Durable Objects Stubs
 *
 * Placeholder implementations for Durable Objects required by wrangler.jsonc.
 * These will be fully implemented in later phases.
 */

import type { DurableObjectState } from '@cloudflare/workers-types';

/**
 * DocumentState - Manages collaborative document editing state.
 * Placeholder implementation for infrastructure validation.
 */
export class DocumentState {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  fetch(_request: Request): Response {
    return new Response(
      JSON.stringify({
        error: 'Not Implemented',
        message: 'DocumentState Durable Object is not yet implemented',
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

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
