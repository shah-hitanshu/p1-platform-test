/**
 * OAuth Configuration Tests (Source-Inspection Pattern)
 *
 * Since @cloudflare/workers-oauth-provider requires cloudflare: imports
 * not available in Vitest, we verify the OAuthProvider configuration
 * by reading the index.ts source file, following the established pattern
 * from workers/mcp-server/tests/auth/oauth-integration.spec.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(__dirname, '../../src/index.ts'), 'utf-8');

describe('OAuthProvider Configuration', () => {
  it('enforces PKCE S256 (allowPlainPKCE: false)', () => {
    expect(indexSource).toContain('allowPlainPKCE: false');
  });

  it('configures authorize endpoint', () => {
    expect(indexSource).toContain("authorizeEndpoint: '/authorize'");
  });

  it('configures token endpoint', () => {
    expect(indexSource).toContain("tokenEndpoint: '/token'");
  });

  it('configures access token TTL (1 hour)', () => {
    expect(indexSource).toContain('accessTokenTTL: 3600');
  });

  it('configures refresh token TTL (30 days)', () => {
    expect(indexSource).toContain('refreshTokenTTL: 2592000');
  });

  it('uses a stub apiRoute (auth server has no resource API)', () => {
    expect(indexSource).toContain("apiRoute: '/auth-api'");
  });
});

describe('Health Endpoint', () => {
  it('health check returns 200', async () => {
    const { handleHealthCheck } = await import('../../src/health.js');
    const response = handleHealthCheck('local');
    expect(response.status).toBe(200);
    const rawBody: unknown = await response.json();
    const body = rawBody as { status: string; service: string };
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('css-auth-server');
  });
});

describe('Authorize Flow Logic', () => {
  it('authorize handler reads client_id to look up site', () => {
    expect(indexSource).toContain('lookupSiteAuthConfig');
  });

  it('authorize handler validates redirect_uri against site allowedOrigins', () => {
    expect(indexSource).toContain('matchesAllowedOrigin');
  });

  it('authorize handler upserts client in OAUTH_KV before parseAuthRequest', () => {
    // Verify the upsert function exists and uses the correct mechanisms:
    // - Direct OAUTH_KV.put() for new clients (createClient() cannot be used — it ignores clientId)
    // - oauthHelpers.updateClient() for existing clients needing a new URI
    expect(indexSource).toContain('upsertClient');
    expect(indexSource).toContain('OAUTH_KV.put');
    expect(indexSource).toContain('updateClient');
    // createClient() must NOT appear in upsertClient — it generates random IDs
    // (The word 'createClient' may appear in comments but not as a function call)
    expect(indexSource).not.toMatch(/oauthHelpers\.createClient\s*\(/);
  });

  it('authorize handler redirects to Google when validation passes', () => {
    expect(indexSource).toContain('getGoogleAuthorizationUrl');
  });

  it('callback handler exchanges Google code', () => {
    expect(indexSource).toContain('exchangeGoogleCode');
  });

  it('callback handler calls completeAuthorization', () => {
    expect(indexSource).toContain('completeAuthorization');
  });
});

describe('Token Validate Endpoint', () => {
  it('exposes /internal/token/validate endpoint', () => {
    expect(indexSource).toContain('/internal/token/validate');
  });

  it('uses oauthHelpers.unwrapToken for token validation', () => {
    expect(indexSource).toContain('unwrapToken');
  });

  it('validates X-Internal-Secret on token validate endpoint', () => {
    expect(indexSource).toContain('INTERNAL_SECRET');
  });

  it('returns JSON body for 401 Unauthorized (no secret header)', () => {
    // All error responses from /internal/token/validate must be JSON for consistent caller handling.
    // The source uses JSON.stringify({ error: 'Unauthorized' }) — verify the JSON payload is present.
    expect(indexSource).toMatch(/JSON\.stringify\(\s*\{\s*error:\s*['"]Unauthorized['"]/);
  });

  it('returns JSON body for 403 Forbidden (wrong secret)', () => {
    expect(indexSource).toMatch(/JSON\.stringify\(\s*\{\s*error:\s*['"]Forbidden['"]/);
  });
});
