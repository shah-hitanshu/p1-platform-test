/**
 * Organization settings loading and caching utilities.
 * Extracted from document-session.ts for maintainability.
 *
 * Fetches organization settings from the database and returns
 * the organization info along with idle timeout configuration.
 */

import type { Organization } from '../types';
import { getOrganizationForSite } from '../services/organization-service';
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
 * @param sessionInfo - Session info containing the siteId
 * @returns The organization settings result
 */
export async function loadOrganizationSettings(
  sessionInfo: SessionInfo,
): Promise<OrgSettingsResult> {
  const { siteId } = sessionInfo;

  // Skip for unknown/invalid session IDs
  if (siteId === 'unknown') {
    return { organization: null };
  }

  try {
    const org = await getOrganizationForSite(siteId);
    return { organization: org };
  } catch (error) {
    console.warn('Failed to load organization settings:', error);
    return { organization: null };
  }
}

/**
 * Force refresh organization settings from the database.
 * This is a convenience wrapper that simply calls loadOrganizationSettings
 * after resetting the caller's cached state.
 *
 * @param sessionInfo - Session info containing the siteId
 * @returns The refreshed organization settings result
 */
export async function refreshOrganizationSettings(
  sessionInfo: SessionInfo,
): Promise<OrgSettingsResult> {
  return loadOrganizationSettings(sessionInfo);
}
