/**
 * Property-Based Tests for matchesAllowedOrigin
 *
 * Tests security invariants across a large sample space using fast-check.
 * Key invariants:
 * 1. A wildcard pattern *-mysite.pantheonsite.io NEVER matches a URL
 *    where the attacker controls any part of the registered suffix.
 * 2. An exact pattern only matches the exact origin.
 * 3. An empty allowedOrigins list always returns false.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { matchesAllowedOrigin } from '../../../src/auth/oauth/origin-validator.js';

const SUFFIX = 'mysite.pantheonsite.io';
const WILDCARD_PATTERN = `*-${SUFFIX}`;

describe('Property: empty list always rejects', () => {
  it('matchesAllowedOrigin(anyUri, []) === false', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        expect(matchesAllowedOrigin(url, [])).toBe(false);
      }),
    );
  });
});

describe('Property: exact match is reflexive', () => {
  it('matchesAllowedOrigin(origin, [origin]) === true for valid https origins', () => {
    fc.assert(
      fc.property(
        fc.domain().map((d) => `https://${d}`),
        (origin) => {
          expect(matchesAllowedOrigin(origin, [origin])).toBe(true);
        },
      ),
    );
  });
});

describe('Property: wildcard NEVER matches suffix-extended hostnames', () => {
  it('*-mysite.pantheonsite.io does not match https://live-mysite.pantheonsite.io.<attacker>', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        (attackerDomain) => {
          const maliciousUrl = `https://live-${SUFFIX}.${attackerDomain}/callback`;
          expect(matchesAllowedOrigin(maliciousUrl, [WILDCARD_PATTERN])).toBe(false);
        },
      ),
    );
  });
});

describe('Property: wildcard matches valid Pantheon branch URLs', () => {
  it('*-mysite.pantheonsite.io matches https://{label}-mysite.pantheonsite.io', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,20}[a-z0-9]$/),
        (label) => {
          const url = `https://${label}-${SUFFIX}/callback`;
          expect(matchesAllowedOrigin(url, [WILDCARD_PATTERN])).toBe(true);
        },
      ),
    );
  });

  it('*-mysite.pantheonsite.io matches single-character label', () => {
    const url = `https://a-${SUFFIX}/callback`;
    expect(matchesAllowedOrigin(url, [WILDCARD_PATTERN])).toBe(true);
  });
});
