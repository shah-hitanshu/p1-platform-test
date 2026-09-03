/**
 * Feature flag evaluation.
 *
 * P1 has no LaunchDarkly SDK of its own. Content Publisher already runs a
 * thin authenticated proxy (the `launchdarklyapi` Cloud Run service) that
 * evaluates a flag for the caller identified by their Auth0 token, and the
 * frontend sends P1 the very same token — so we forward it rather than
 * standing up a second LaunchDarkly integration.
 *
 * This is only consulted on the "email has no app.users row" path, and a
 * successful evaluation provisions that row, so a given user costs at most one
 * extra hop on their first ever P1 request.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Env } from '../env';

/** The gate that opens P1 to a user who was never explicitly allowlisted. */
export const P1V0_FLAG = 'P1V0';

/** How long a flag evaluation is trusted, in seconds. */
const FLAG_CACHE_TTL_SECONDS = 300;

/** Give up rather than hold a request open if the proxy is slow. */
const FLAG_REQUEST_TIMEOUT_MS = 3000;

interface LdProxyResponse {
  value?: unknown;
}

function cacheKey(flag: string, email: string): string {
  return `feature-flag:${flag}:${email.toLowerCase()}`;
}

/**
 * Evaluates a LaunchDarkly flag for the user behind `authorizationHeader`.
 *
 * Fails closed: any missing configuration, non-2xx response, timeout or parse
 * failure returns false. A flag that decides whether a stranger may use the
 * platform must not open up because a dependency is down.
 *
 * @param env - worker env; LAUNCHDARKLY_API_URL must point at CP's proxy
 * @param authorizationHeader - the caller's raw `Authorization` header
 * @param email - used only as the cache key; the proxy derives identity from the token
 */
export async function isFeatureFlagEnabled(
  env: Env,
  authorizationHeader: string | null,
  email: string,
  flag: string = P1V0_FLAG,
): Promise<boolean> {
  const proxyUrl = env.LAUNCHDARKLY_API_URL;
  if (proxyUrl === undefined || proxyUrl === '') {
    return false;
  }
  if (authorizationHeader === null || authorizationHeader === '') {
    return false;
  }

  const key = cacheKey(flag, email);

  try {
    const cached = await env.CONFIG_KV.get(key);
    if (cached !== null) {
      return cached === 'true';
    }
  } catch (error) {
    // A KV read failure is not a reason to deny access — fall through and ask.
    getLogger().error('Feature flag cache read failed', error instanceof Error ? error : new Error(String(error)), {});
  }

  let enabled = false;
  try {
    const response = await fetch(`${proxyUrl}/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorizationHeader,
      },
      body: JSON.stringify({ feature: flag }),
      signal: AbortSignal.timeout(FLAG_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      getLogger().error('Feature flag proxy returned non-OK status', new Error(`HTTP ${String(response.status)}`), { flag, status: response.status });
      return false;
    }

    const body = await response.json<LdProxyResponse>();
    enabled = body.value === true;
  } catch (error) {
    getLogger().error('Feature flag evaluation failed', error instanceof Error ? error : new Error(String(error)), { flag });
    return false;
  }

  try {
    await env.CONFIG_KV.put(key, enabled ? 'true' : 'false', {
      expirationTtl: FLAG_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    getLogger().error('Feature flag cache write failed', error instanceof Error ? error : new Error(String(error)), {});
  }

  return enabled;
}
