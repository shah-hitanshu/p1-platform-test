/**
 * Base Endpoint
 *
 * Shared HTTP request logic for all endpoints.
 */

import type { AuthProvider } from '../auth.js';
import type { Principal } from '../types.js';
import {
  CSSApiError,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  SessionExpiredError,
} from '../errors.js';

export interface BaseEndpointConfig {
  baseUrl: string;
  authProvider?: AuthProvider;
  principal?: Principal;
  /**
   * Session ID for agent authorization.
   * When set, the X-Agent-Session-Id header will be sent with all requests.
   */
  sessionId?: string;
  /**
   * Optional token refresher for dynamic token management.
   * Called when a 401 Unauthorized response is received.
   * Returns a fresh token string, or null if the session cannot be refreshed.
   */
  tokenRefresher?: () => Promise<string | null>;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: string;
  headers?: Record<string, string>;
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

export class BaseEndpoint {
  private readonly baseUrl: string;
  private readonly authProvider?: AuthProvider;
  private readonly principal?: Principal;
  private readonly sessionId?: string;
  private readonly tokenRefresher?: () => Promise<string | null>;

  constructor(config: BaseEndpointConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authProvider = config.authProvider;
    this.principal = config.principal;
    this.sessionId = config.sessionId;
    this.tokenRefresher = config.tokenRefresher;
  }

  /**
   * Make an authenticated HTTP request to the CSS API.
   */
  async request<T>(path: string, options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add authentication header
    if (this.authProvider) {
      try {
        const authValue = await this.authProvider();
        // Check if this is an API key (prefixed with "ApiKey ") or a Bearer token
        if (authValue.startsWith('ApiKey ')) {
          headers['X-API-Key'] = authValue.substring(7); // Remove "ApiKey " prefix
        } else {
          headers['Authorization'] = authValue;
        }
      } catch (error) {
        throw new AuthenticationError(
          error instanceof Error ? error.message : 'Failed to get auth token'
        );
      }
    }

    // Add principal headers if available
    if (this.principal) {
      headers['X-Principal-Id'] = this.principal.id;
      headers['X-Principal-Type'] = this.principal.type;
    }

    // Add session ID header for agent authorization
    if (this.sessionId) {
      headers['X-Agent-Session-Id'] = this.sessionId;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body,
      });
    } catch (error) {
      throw new NetworkError(
        `Network request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }

    // Handle 401 with token refresh
    if (response.status === 401 && this.tokenRefresher) {
      const freshToken = await this.tokenRefresher();
      if (freshToken) {
        // Retry with fresh token as Bearer Authorization header
        headers['Authorization'] = `Bearer ${freshToken}`;
        try {
          response = await fetch(url, {
            method: options.method,
            headers,
            body: options.body,
          });
        } catch (error) {
          throw new NetworkError(
            `Network request failed on retry: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error instanceof Error ? error : undefined,
          );
        }
        if (response.status === 401) {
          throw new SessionExpiredError();
        }
      } else {
        throw new SessionExpiredError();
      }
    }

    // Handle successful responses
    if (response.ok) {
      // 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new CSSApiError('Failed to parse response JSON', response.status);
      }
    }

    // Handle error responses
    let errorData: ErrorResponse | null = null;
    try {
      errorData = (await response.json()) as ErrorResponse;
    } catch {
      // Ignore JSON parse errors for error responses
    }

    const errorMessage = errorData?.error ?? `HTTP ${response.status}`;

    switch (response.status) {
      case 400:
        throw new ValidationError(errorMessage, errorData?.details);
      case 401:
        throw new AuthenticationError(errorMessage);
      case 404:
        throw new NotFoundError(errorMessage);
      case 409:
        throw new ConflictError(errorMessage, errorData?.details);
      default:
        throw new CSSApiError(errorMessage, response.status, undefined, errorData?.details);
    }
  }

  /**
   * Create a new BaseEndpoint with updated principal.
   */
  withPrincipal(principal: Principal): BaseEndpoint {
    return new BaseEndpoint({
      baseUrl: this.baseUrl,
      authProvider: this.authProvider,
      principal,
      sessionId: this.sessionId,
      tokenRefresher: this.tokenRefresher,
    });
  }

  /**
   * Create a new BaseEndpoint with session ID for agent authorization.
   */
  withSessionId(sessionId: string): BaseEndpoint {
    return new BaseEndpoint({
      baseUrl: this.baseUrl,
      authProvider: this.authProvider,
      principal: this.principal,
      sessionId,
      tokenRefresher: this.tokenRefresher,
    });
  }
}
