/**
 * Base API Client
 *
 * Provides fetch wrapper with authentication and error handling.
 */

import type { ApiError } from '../types';

const TOKEN_KEY = 'css_auth_token';

/**
 * Get the stored auth token
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Store the auth token
 */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Clear the stored token
 */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Check if we have a stored token
 */
export function isAuthenticated(): boolean {
  return getToken() !== null;
}

/**
 * API error class
 */
export class ApiClientError extends Error {
  public status: number;
  public details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Fetch wrapper with auth headers
 */
async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Generic API GET request
 */
export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetchWithAuth(url);

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new ApiClientError(
      error.error || 'Request failed',
      response.status,
      error.details
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Generic API POST request
 */
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetchWithAuth(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new ApiClientError(
      error.error || 'Request failed',
      response.status,
      error.details
    );
  }

  // Handle 201 Created and 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Generic API PATCH request
 */
export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const response = await fetchWithAuth(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new ApiClientError(
      error.error || 'Request failed',
      response.status,
      error.details
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Generic API DELETE request
 */
export async function apiDelete(url: string): Promise<void> {
  const response = await fetchWithAuth(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new ApiClientError(
      error.error || 'Request failed',
      response.status,
      error.details
    );
  }
}
