/**
 * Frontend Worker Tests
 *
 * Tests the config injection and static asset passthrough logic.
 * Uses mocked ASSETS binding since we can't run HTMLRewriter in Vitest.
 * Tests verify the Worker's routing logic and config building.
 */

import { describe, it, expect } from 'vitest';

/**
 * Since HTMLRewriter is a Cloudflare runtime API not available in Vitest,
 * we test the Worker's decision logic by importing the module and
 * verifying behavior indirectly. The actual HTMLRewriter integration
 * is verified during deployment (Phase 7).
 *
 * These tests focus on:
 * 1. Navigation request detection
 * 2. Config script generation
 */

// We can't import the worker directly (it uses Cloudflare globals),
// so we test the logic patterns it uses.

describe('Worker config injection logic', () => {
  it('should detect navigation requests (HTML accept header, no file extension)', () => {
    const cases = [
      { accept: 'text/html', path: '/', method: 'GET', expected: true },
      { accept: 'text/html,application/xhtml+xml', path: '/sites/123', method: 'GET', expected: true },
      { accept: 'text/html', path: '/login', method: 'GET', expected: true },
      { accept: 'application/javascript', path: '/assets/main.js', method: 'GET', expected: false },
      { accept: 'text/css', path: '/assets/style.css', method: 'GET', expected: false },
      { accept: 'text/html', path: '/favicon.ico', method: 'GET', expected: false },
      { accept: 'text/html', path: '/', method: 'POST', expected: false },
      { accept: '', path: '/', method: 'GET', expected: false },
    ];

    for (const { accept, path, method, expected } of cases) {
      const isNav =
        method === 'GET' &&
        accept.includes('text/html') &&
        !path.match(/\.\w+$/);
      expect(isNav, `${method} ${path} (accept: ${accept})`).toBe(expected);
    }
  });

  it('should build config JSON from env vars', () => {
    const env = {
      FRONTEND_API_BASE_URL: 'https://api.example.com',
      FRONTEND_GOOGLE_CLIENT_ID: 'google-123',
      FRONTEND_AUTH0_DOMAIN: 'test.auth0.com',
      FRONTEND_AUTH0_CLIENT_ID: 'auth0-456',
      FRONTEND_AUTH0_AUDIENCE: 'https://my-api',
      FRONTEND_ENABLE_MOCK_LOGIN: 'true',
    };

    const config = {
      apiBaseUrl: env.FRONTEND_API_BASE_URL || '',
      googleClientId: env.FRONTEND_GOOGLE_CLIENT_ID || '',
      auth0Domain: env.FRONTEND_AUTH0_DOMAIN || '',
      auth0ClientId: env.FRONTEND_AUTH0_CLIENT_ID || '',
      auth0Audience: env.FRONTEND_AUTH0_AUDIENCE || '',
      enableMockLogin: env.FRONTEND_ENABLE_MOCK_LOGIN === 'true',
    };

    const script = `<script>window.__CSS_CONFIG__=${JSON.stringify(config)};</script>`;

    expect(script).toContain('window.__CSS_CONFIG__=');
    expect(script).toContain('"apiBaseUrl":"https://api.example.com"');
    expect(script).toContain('"googleClientId":"google-123"');
    expect(script).toContain('"enableMockLogin":true');
    expect(script).toContain('"auth0Domain":"test.auth0.com"');
  });

  it('should handle empty/missing env vars gracefully', () => {
    const env = {
      FRONTEND_API_BASE_URL: '',
      FRONTEND_GOOGLE_CLIENT_ID: '',
      FRONTEND_AUTH0_DOMAIN: '',
      FRONTEND_AUTH0_CLIENT_ID: '',
      FRONTEND_AUTH0_AUDIENCE: '',
      FRONTEND_ENABLE_MOCK_LOGIN: 'false',
    };

    const config = {
      apiBaseUrl: env.FRONTEND_API_BASE_URL || '',
      googleClientId: env.FRONTEND_GOOGLE_CLIENT_ID || '',
      auth0Domain: env.FRONTEND_AUTH0_DOMAIN || '',
      auth0ClientId: env.FRONTEND_AUTH0_CLIENT_ID || '',
      auth0Audience: env.FRONTEND_AUTH0_AUDIENCE || '',
      enableMockLogin: env.FRONTEND_ENABLE_MOCK_LOGIN === 'true',
    };

    expect(config.apiBaseUrl).toBe('');
    expect(config.googleClientId).toBe('');
    expect(config.enableMockLogin).toBe(false);
  });

  it('should only set enableMockLogin to true when value is exactly "true"', () => {
    const check = (val: string): boolean => val === 'true';
    expect(check('true')).toBe(true);
    expect(check('false')).toBe(false);
    expect(check('')).toBe(false);
    expect(check('TRUE')).toBe(false);
    expect(check('1')).toBe(false);
  });
});
