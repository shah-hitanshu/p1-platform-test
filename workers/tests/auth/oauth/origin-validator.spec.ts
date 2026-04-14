/**
 * Origin Validator Tests
 *
 * Tests matchesAllowedOrigin() — the security-critical function that
 * validates OAuth redirect URIs against a site's allowedOrigins list.
 *
 * Security invariants tested:
 * - Wildcard anchoring: *-mysite.pantheonsite.io must NOT match attacker.com
 * - Exact match: only exact strings are accepted for non-wildcard patterns
 * - Empty list: always rejects
 * - Trailing slash normalization
 */

import { describe, it, expect } from 'vitest';
import { matchesAllowedOrigin } from '../../../src/auth/oauth/origin-validator.js';

describe('matchesAllowedOrigin', () => {
  // --- Exact matching ---

  it('accepts exact match', () => {
    expect(matchesAllowedOrigin('https://mysite.com', ['https://mysite.com'])).toBe(true);
  });

  it('rejects when list is empty', () => {
    expect(matchesAllowedOrigin('https://mysite.com', [])).toBe(false);
  });

  it('rejects exact non-match', () => {
    expect(matchesAllowedOrigin('https://evil.com', ['https://mysite.com'])).toBe(false);
  });

  it('accepts localhost for development', () => {
    expect(matchesAllowedOrigin(
      'http://localhost:3000',
      ['http://localhost:3000'],
    )).toBe(true);
  });

  it('rejects wrong port', () => {
    expect(matchesAllowedOrigin(
      'http://localhost:4000',
      ['http://localhost:3000'],
    )).toBe(false);
  });

  // --- Wildcard matching ---

  it('accepts wildcard Pantheon branch URL (live env)', () => {
    expect(matchesAllowedOrigin(
      'https://live-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(true);
  });

  it('accepts wildcard Pantheon branch URL (dev env)', () => {
    expect(matchesAllowedOrigin(
      'https://dev-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(true);
  });

  it('accepts wildcard Pantheon branch URL (test env)', () => {
    expect(matchesAllowedOrigin(
      'https://test-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(true);
  });

  // SECURITY: wildcard must NOT match attacker-controlled domains
  it('SECURITY: wildcard does not match attacker subdomain hijack', () => {
    expect(matchesAllowedOrigin(
      'https://live-mysite.pantheonsite.io.evil.com',
      ['*-mysite.pantheonsite.io'],
    )).toBe(false);
  });

  it('SECURITY: wildcard does not match subdomain of allowed pattern', () => {
    expect(matchesAllowedOrigin(
      'https://sub.live-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(false);
  });

  it('SECURITY: wildcard requires https scheme for non-localhost', () => {
    expect(matchesAllowedOrigin(
      'http://live-mysite.pantheonsite.io',
      ['*-mysite.pantheonsite.io'],
    )).toBe(false);
  });

  // --- Multiple patterns ---

  it('accepts when redirect_uri matches any pattern in the list', () => {
    expect(matchesAllowedOrigin('https://mysite.com', [
      '*-mysite.pantheonsite.io',
      'https://mysite.com',
    ])).toBe(true);
  });

  it('rejects when redirect_uri matches none of the patterns', () => {
    expect(matchesAllowedOrigin('https://evil.com', [
      '*-mysite.pantheonsite.io',
      'https://mysite.com',
    ])).toBe(false);
  });

  // --- Operator trust: wildcard patterns for non-Pantheon domains ---
  // SECURITY BOUNDARY: Wildcard patterns are not restricted to Pantheon domains.
  // The operator is trusted to configure only appropriate patterns.
  // These tests document this intentional behavior explicitly.

  it('OPERATOR TRUST: wildcard for non-Pantheon domain matches single-label subdomain', () => {
    // An operator could configure *-example.com — this is intentional.
    // Only Pantheon-managed domains should appear in allowedOrigins in practice.
    expect(matchesAllowedOrigin(
      'https://a-example.com',
      ['*-example.com'],
    )).toBe(true);
  });

  it('OPERATOR TRUST: wildcard for non-Pantheon domain does NOT match multi-label prefix', () => {
    expect(matchesAllowedOrigin(
      'https://sub.live-example.com',
      ['*-example.com'],
    )).toBe(false);
  });

  // --- Redirect URI normalization ---

  it('ignores path and query string (compares origin only)', () => {
    // The redirect_uri may include a path (e.g. /callback) — we compare origin only
    expect(matchesAllowedOrigin('https://mysite.com/callback', [
      'https://mysite.com',
    ])).toBe(true);
  });

  it('ignores trailing slash on exact pattern', () => {
    expect(matchesAllowedOrigin('https://mysite.com/', ['https://mysite.com'])).toBe(true);
  });

  // --- Malformed inputs ---

  it('rejects malformed redirect URI', () => {
    expect(matchesAllowedOrigin('not-a-url', ['https://mysite.com'])).toBe(false);
  });

  it('rejects empty redirect URI', () => {
    expect(matchesAllowedOrigin('', ['https://mysite.com'])).toBe(false);
  });
});
