import type { Env } from './types';

const MAX_CACHE_SIZE = 1000;
// Cache key: `${token}\0${siteId}` — null-byte separator prevents collisions.
// Only true results are cached; failures are re-checked on every request.
const tokenCache = new Map<string, { expires: number }>();

export async function validateAuth(
  request: Request,
  env: Env,
  siteId: string,
): Promise<true | false | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) {
    return null;
  }

  const cacheKey = `${token}\0${siteId}`;

  // Check cache — presence means previously authorized
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return true;
  }

  try {
    let response: Response;
    const url = `${env.CSS_BASE_URL}/api/sites/${encodeURIComponent(siteId)}`;

    if (env.CSS_SERVICE) {
      // Use service binding to avoid Cloudflare's same-account
      // Worker-to-Worker fetch restriction (error 1042).
      // Must use the real CSS URL so the receiving worker gets the correct Host header.
      response = await env.CSS_SERVICE.fetch(
        new Request(url, {
          method: 'GET',
          headers: { Authorization: authHeader },
        }),
      );
    } else {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: authHeader },
      });
    }

    if (response.status === 200) {
      // Evict oldest entry if cache is full
      if (tokenCache.size >= MAX_CACHE_SIZE) {
        const firstKey = tokenCache.keys().next().value;
        if (firstKey) tokenCache.delete(firstKey);
      }
      tokenCache.set(cacheKey, { expires: Date.now() + 60_000 });
      return true;
    }

    // 403 or 404 — valid token, no access (treat site-not-found as no access)
    if (response.status === 403 || response.status === 404) {
      return false;
    }

    // 401 or anything unexpected — treat as invalid token
    return null;
  } catch (err) {
    console.error('validateAuth: CSS site check failed', err);
    return null;
  }
}
