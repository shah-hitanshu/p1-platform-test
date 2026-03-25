import { Env } from './types';

const MAX_CACHE_SIZE = 1000;
const tokenCache = new Map<string, { valid: boolean; expires: number }>();

export async function validateAuth(
  request: Request,
  env: Env,
): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  if (!token) {
    return false;
  }

  // Check cache
  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.valid;
  }

  try {
    const response = await fetch(`${env.CSS_BASE_URL}/api/auth/me`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
    });

    const valid = response.ok;

    // Only cache valid tokens to avoid locking out users on transient errors
    if (valid) {
      // Evict oldest entries if cache is too large
      if (tokenCache.size >= MAX_CACHE_SIZE) {
        const firstKey = tokenCache.keys().next().value;
        if (firstKey) tokenCache.delete(firstKey);
      }
      tokenCache.set(token, {
        valid: true,
        expires: Date.now() + 60_000,
      });
    }

    return valid;
  } catch {
    return false;
  }
}
