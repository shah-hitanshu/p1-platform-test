/**
 * CSS Auth OAuth Provider Setup
 *
 * Creates and exports the OAuthProvider instance used by the main
 * collaborative-state-worker for the /auth/* route prefix.
 *
 * The OAuthProvider handles:
 *   GET  /auth/authorize         — parse request, redirect to Google
 *   POST /auth/token             — PKCE code exchange, issue access token
 *   POST /auth/register          — dynamic client registration (not used by CSS)
 *   GET  /auth/callback          — Google redirect callback (via defaultHandler)
 *   POST /auth/api/*             — stub API (returns 404 — auth has no resource API)
 *
 * Route wiring in workers/src/index.ts dispatches all /auth/* requests to
 * authOAuthProvider.fetch() before the main authenticate() middleware runs.
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { AuthOAuthEnv } from '../../routes/auth-routes.js';
import { authDefaultHandler, authApiHandler } from '../../routes/auth-routes.js';

export const authOAuthProvider = new OAuthProvider<AuthOAuthEnv>({
  apiRoute: '/auth/api',           // Stub — no resource API on the auth provider
  apiHandler: authApiHandler,
  defaultHandler: authDefaultHandler,
  authorizeEndpoint: '/auth/authorize',
  tokenEndpoint: '/auth/token',
  clientRegistrationEndpoint: '/auth/register',
  allowPlainPKCE: false,           // Enforce S256 only (OAuth 2.1 requirement)
  accessTokenTTL: 3600,            // 1 hour
  refreshTokenTTL: 2592000,        // 30 days
});
