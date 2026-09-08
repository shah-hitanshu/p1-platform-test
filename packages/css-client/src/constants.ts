export const PRODUCTION_BASE_URL = 'https://ccr.p1.pantheon.io';

/**
 * Treats an unset or blank/whitespace base URL as unset, defaulting to the
 * production CCR backend. Shared by every css-client entry point that
 * accepts a base URL (P1ContentClient, brokerLogout) so a consumer that
 * leaves it unconfigured — or whose env var is defined but empty — still
 * reaches the real backend instead of failing to connect.
 */
export function resolveBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  return trimmed ? trimmed : PRODUCTION_BASE_URL;
}
