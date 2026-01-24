/**
 * Auth API Module
 *
 * Handles authentication with the mock identity provider.
 */

import type { LoginResponse, UsersResponse, HealthResponse } from '../types';

/**
 * Get list of available users and agents for login
 */
export async function getUsers(): Promise<UsersResponse> {
  const response = await fetch('/api/auth/users');

  if (!response.ok) {
    throw new Error('Failed to fetch users');
  }

  return response.json() as Promise<UsersResponse>;
}

/**
 * Login as a user and get a JWT token
 */
export async function loginAsUser(userId: string): Promise<LoginResponse> {
  const response = await fetch('/api/auth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  return response.json() as Promise<LoginResponse>;
}

/**
 * Get health status
 */
export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch('/health');

  if (!response.ok) {
    throw new Error('Health check failed');
  }

  return response.json() as Promise<HealthResponse>;
}
