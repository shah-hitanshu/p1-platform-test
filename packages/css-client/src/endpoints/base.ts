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
} from '../errors.js';

export interface BaseEndpointConfig {
  baseUrl: string;
  authProvider?: AuthProvider;
  principal?: Principal;
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

  constructor(config: BaseEndpointConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authProvider = config.authProvider;
    this.principal = config.principal;
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
        headers['Authorization'] = await this.authProvider();
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
    });
  }
}
