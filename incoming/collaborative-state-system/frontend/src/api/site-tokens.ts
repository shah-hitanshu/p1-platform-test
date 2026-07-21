/**
 * Site API Tokens Module
 *
 * Endpoints for managing site-level API tokens.
 */

import type { SiteApiToken } from '../types';
import { apiGet, apiPost, apiDelete } from './client';

interface TokensResponse {
  tokens: SiteApiToken[];
}

export interface GenerateTokenParams {
  name: string;
  scopes?: string[];
}

export interface GenerateTokenResult {
  id: string;
  token: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
}

/**
 * List all API tokens for a site
 */
export async function listSiteTokens(siteId: string): Promise<SiteApiToken[]> {
  const response = await apiGet<TokensResponse>(`/api/sites/${siteId}/tokens`);
  return response.tokens;
}

/**
 * Generate a new API token for a site
 */
export async function generateSiteToken(
  siteId: string,
  params: GenerateTokenParams,
): Promise<GenerateTokenResult> {
  return apiPost<GenerateTokenResult>(`/api/sites/${siteId}/tokens`, params);
}

/**
 * Revoke an API token from a site
 */
export async function revokeSiteToken(
  siteId: string,
  tokenId: string,
): Promise<void> {
  return apiDelete(`/api/sites/${siteId}/tokens/${tokenId}`);
}
