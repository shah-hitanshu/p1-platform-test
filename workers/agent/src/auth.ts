import type { ValidatedUser } from './types.js';

export async function validateCSSToken(token: string, cssBackendUrl: string): Promise<ValidatedUser> {
  const url = `${cssBackendUrl.replace(/\/$/, '')}/api/auth/me`;
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
