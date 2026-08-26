/**
 * Organization settings loading and caching utilities.
 * Extracted from document-session.ts for maintainability.
 *
 * Fetches organization settings from the database and returns
 * the organization info along with idle timeout configuration.
 */

import { getLogger } from '@pantheon-systems/p1-telemetry';
import type { Organization } from '../types';
import { getOrganizationForSite } from '../services/organization-service';
import { runWithEnvConnection } from '../db';
import type { ConnectionEnv } from '../db/resolve-connection';
import type { SessionInfo } from './document-session-types';

/**
 * Result of loading organization settings.
 */
export interface OrgSettingsResult {
  /** The organization, or null if no org is linked to the site */
  organization: Organization | null;
}

/**
 * Load organization settings from the database.
 * Returns the organization associated with the site, or null.
 *
 * A Durable Object runs outside the worker's request scope, so it has to open
 * its own connection rather than inherit one from `runWithConnection`.
 *
 * @param sessionInfo - Session info containing the siteId
 * @param env - Bindings used to open a database connection
 * @returns The organization settings result
 */
export async function loadOrganizationSettings(
  sessionInfo: SessionInfo,
  env: ConnectionEnv,
): Promise<OrgSettingsResult> {
  const { siteId } = sessionInfo;

  // Skip for unknown/invalid session IDs
  if (siteId === 'unknown') {
    return { organization: null };
  }

  try {
    const org = await runWithEnvConnection(env, () => getOrganizationForSite(siteId));
    return { organization: org };
  } catch (error) {
    getLogger().warn('Failed to load organization settings', {
      siteId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { organization: null };
  }
}

/**
 * Force refresh organization settings from the database.
 * This is a convenience wrapper that simply calls loadOrganizationSettings
 * after resetting the caller's cached state.
 *
 * @param sessionInfo - Session info containing the siteId
 * @param env - Bindings used to open a database connection
 * @returns The refreshed organization settings result
 */
export async function refreshOrganizationSettings(
  sessionInfo: SessionInfo,
  env: ConnectionEnv,
): Promise<OrgSettingsResult> {
  return loadOrganizationSettings(sessionInfo, env);
}
