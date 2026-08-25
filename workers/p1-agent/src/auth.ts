import type { ValidatedUser } from './types.js';

export async function validateCCRToken(token: string, ccrBackendUrl: string): Promise<ValidatedUser> {
  const url = `${ccrBackendUrl.replace(/\/$/, '')}/api/auth/me`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Auth validation failed: ${response.status}`);
  }

  const data = await response.json() as { id: string; email: string; name?: string };
  if (!data.id || !data.email) {
    throw new Error('Invalid user data from auth endpoint');
  }
  return data;
}
