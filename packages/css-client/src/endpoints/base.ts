/**
 * Base Endpoint
 *
 * Shared HTTP request logic for all endpoints.
 */

import type { AuthProvider } from '../auth.js';
import type { Principal } from '../types.js';
import {
  attachRequestId,
  P1ApiError,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  SessionExpiredError,
  MissingParameterError,
} from '../errors.js';
import {
  correlationHeaders,
  newRequestId,
  SDK_NAME,
  SDK_VERSION,
  TELEMETRY_HEADERS,
  type SdkIdentity,
} from '../telemetry-headers.js';

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
  /**
   * Identifies the calling SDK in `x-p1-sdk`. Defaults to this package; a wrapper such
   * as `p1-next-sdk` passes its own so the backend sees which one is in the field.
   */
  sdk?: SdkIdentity;
  /** Caller-supplied application identifier, sent as `x-p1-client-id`. */
  clientId?: string;
  /** See {@link CorrelationHeaderOptions.getTraceparent}. */
  getTraceparent?: () => string | undefined;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: string;
  headers?: Record<string, string>;
  /** Let the request outlive page teardown. Subject to the ~64KB body limit. */
  keepalive?: boolean;
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Prefer the id the server reports, falling back to the one we sent.
 *
 * Tolerates a response without a `Headers` instance: callers can inject their own fetch
 * implementation, and a response-like object is a legitimate thing to receive. Reading a
 * correlation id must never be what breaks someone's API call.
 */
function adoptServerRequestId(response: Response, fallback: string): string {
  const headers = (response as { headers?: Headers }).headers;
  const echoed = typeof headers?.get === 'function' ? headers.get(TELEMETRY_HEADERS.requestId) : null;
  return echoed !== null && echoed.trim() !== '' ? echoed.trim() : fallback;
}

/**
 * Reject a path with an empty interior segment rather than sending it.
 *
 * An undefined or blank interpolated value leaves `/branches//templates`, which edge
 * proxies collapse to `/branches/templates` — the API then reads `templates` as the
 * branch and reports a confusing "Branch not found".
 *
 * Interior segments only, and that limit is load-bearing: a trailing empty segment has
 * to stay legal because `/documents/by-path/` is how the root document is addressed. So
 * a blank *trailing* parameter still gets through here, and the API strips the slash and
 * serves the collection route — `branches.get(siteId, '')` would return the branch
 * *list* as a `Branch`. Only a named `requirePathParams` check catches that shape, which
 * is why the single-resource getters carry one.
 */
function assertNoEmptyInteriorSegment(path: string): void {
  const [pathname = ''] = path.split('?');
  if (pathname.includes('//')) {
    throw new MissingParameterError(
      undefined,
      `request path "${path}" — a value interpolated into the URL was empty`,
    );
  }
}

export class BaseEndpoint {
  private readonly baseUrl: string;
  private readonly authProvider?: AuthProvider;
  private readonly principal?: Principal;
  private readonly sessionId?: string;
  private readonly tokenRefresher?: () => Promise<string | null>;
  private readonly sdk: SdkIdentity;
  private readonly clientId?: string;
  private readonly getTraceparent?: () => string | undefined;

  constructor(config: BaseEndpointConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authProvider = config.authProvider;
    this.principal = config.principal;
    this.sessionId = config.sessionId;
    this.tokenRefresher = config.tokenRefresher;
    this.sdk = config.sdk ?? { name: SDK_NAME, version: SDK_VERSION };
    this.clientId = config.clientId;
    this.getTraceparent = config.getTraceparent;
  }

  /**
   * Make an authenticated HTTP request to the P1 API.
   *
   * Every failure leaves here carrying the request id, so a caller can quote it and the
   * server-side story for this exact call can be found. Stamped in one place rather than
   * at each of the throw sites below.
   */
  async request<T>(path: string, options: RequestOptions): Promise<T> {
    // Minted client-side so an id exists even when the request never reaches the API — a
    // network failure still gives the caller something to quote. If the API responds it
    // echoes the id back, and that value wins.
    const correlation = { requestId: newRequestId() };
    assertNoEmptyInteriorSegment(path);
    try {
      return await this.send<T>(path, options, correlation);
    } catch (error) {
      throw error instanceof Error ? attachRequestId(error, correlation.requestId) : error;
    }
  }

  private async send<T>(
    path: string,
    options: RequestOptions,
    correlation: { requestId: string },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const { requestId } = correlation;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...correlationHeaders({
        sdk: this.sdk,
        requestId,
        clientId: this.clientId,
        getTraceparent: this.getTraceparent,
      }),
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
        keepalive: options.keepalive,
      });
    } catch (error) {
      throw new NetworkError(
        `Network request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
    // The server's id wins: it may have rejected ours as malformed and minted its own,
    // and the whole point is to name the id the server actually logged.
    correlation.requestId = adoptServerRequestId(response, correlation.requestId);

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
            keepalive: options.keepalive,
          });
        } catch (error) {
          throw new NetworkError(
            `Network request failed on retry: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error instanceof Error ? error : undefined,
          );
        }
        correlation.requestId = adoptServerRequestId(response, correlation.requestId);
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
        throw new P1ApiError('Failed to parse response JSON', response.status);
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
        throw new P1ApiError(errorMessage, response.status, undefined, errorData?.details);
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
