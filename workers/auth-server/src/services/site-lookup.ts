/**
 * Site Auth Config Lookup
 *
 * Retrieves a site's allowed OAuth redirect origins from the main CSS worker
 * via a Cloudflare service binding. The main CSS worker owns the database
 * connection and exposes an internal endpoint for this purpose.
 */

export interface SiteAuthConfig {
  siteId: string;
  allowedOrigins: string[];
}

/**
 * Fetch the site's OAuth configuration from the main CSS worker.
 *
 * @param cssBackend - Service binding to the main CSS worker
 * @param internalSecret - Shared secret for internal API authentication
 * @param siteId - The site ID (also the OAuth client_id)
 * @returns SiteAuthConfig if the site exists, null if not found
 * @throws Error if the CSS worker returns an unexpected error status
 */
export async function lookupSiteAuthConfig(
  cssBackend: Fetcher,
  internalSecret: string,
  siteId: string,
): Promise<SiteAuthConfig | null> {
  // siteId is always a UUID — no URL-encoding needed.
  const response = await cssBackend.fetch(
    `http://internal/internal/site-auth-config/${siteId}`,
    {
      method: 'GET',
      headers: {
        'X-Internal-Secret': internalSecret,
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Site auth config lookup failed: ${String(response.status)}`);
  }

  const rawData: unknown = await response.json();

  // Validate the shape of the response before using it.
  // An invalid shape here would cause matchesAllowedOrigin() to throw with a
  // misleading error — surface the problem early with a descriptive message.
  const rawAllowedOrigins = (rawData as Record<string, unknown>).allowedOrigins;
  if (
    typeof rawData !== 'object' ||
    rawData === null ||
    !Array.isArray(rawAllowedOrigins)
  ) {
    throw new Error('Invalid site config response: missing allowedOrigins');
  }

  // Validate each element is a non-empty string. A response with mixed types
  // (e.g. [123, "", null]) would otherwise reach matchesAllowedOrigin() and
  // produce unpredictable behaviour or incorrect origin matches.
  if (!rawAllowedOrigins.every((o) => typeof o === 'string' && o.length > 0)) {
    throw new Error('Invalid site config response: allowedOrigins must be non-empty strings');
  }

  return {
    siteId: (rawData as Record<string, unknown>).siteId as string,
    allowedOrigins: rawAllowedOrigins as string[],
  };
}
