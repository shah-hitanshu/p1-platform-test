/**
 * Users API Module
 *
 * Admin endpoints for managing system-level user allowlist.
 */

import type { SystemUser } from '../types';
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

interface UsersResponse {
  users: SystemUser[];
}

export interface AddUserParams {
  email: string;
  name?: string;
  systemRole?: 'admin' | 'member';
}

export interface UpdateUserParams {
  name?: string;
  systemRole?: 'admin' | 'member';
  isActive?: boolean;
}

/**
 * List all users
 */
export async function listUsers(): Promise<SystemUser[]> {
  const response = await apiGet<UsersResponse>('/api/admin/users');
  return response.users;
}

/**
 * Add a user to the allowlist
 */
export async function addUser(params: AddUserParams): Promise<SystemUser> {
  return apiPost<SystemUser>('/api/admin/users', params);
}

/**
 * Update a user
 */
export async function updateUser(
  userId: string,
  params: UpdateUserParams,
): Promise<SystemUser> {
  return apiPatch<SystemUser>(`/api/admin/users/${userId}`, params);
}

/**
 * Remove a user from the allowlist
 */
export async function removeUser(userId: string): Promise<void> {
  return apiDelete(`/api/admin/users/${userId}`);
}
