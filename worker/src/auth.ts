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
    let response: Response;

    if (env.CSS_SERVICE) {
      // Use service binding to avoid Cloudflare's same-account
      // Worker-to-Worker fetch restriction (error 1042).
      // Must use the real CSS URL so the receiving worker gets the correct Host header.
      response = await env.CSS_SERVICE.fetch(
        new Request(`${env.CSS_BASE_URL}/api/auth/me`, {
          method: 'GET',
          headers: { Authorization: authHeader },
        }),
      );
    } else {
      response = await fetch(`${env.CSS_BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: { Authorization: authHeader },
      });
    }

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
