/**
 * PCC-3531 phase 2. The stored redirect is where a freshly-authenticated user
 * lands, so these encode one rule: fail-closed on the proposal, fall back to the
 * caller's own value. Never an error, never the unvalidated proposal.
 */

import { describe, it, expect } from 'vitest';
import { resolveBrokerRedirectUrl } from '../../../src/auth/broker/redirect-origin.js';

const FALLBACK = 'https://fallback.example.com/p1';
const BRANCH_WILDCARD = 'https://*-mysite.pantheonsite.io';

describe('resolveBrokerRedirectUrl', () => {
  describe('no proposal — behaviour must be identical to today', () => {
    it('returns the fallback untouched and warns about nothing', () => {
      const result = resolveBrokerRedirectUrl({
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeUndefined();
    });

    it('returns undefined when there is no fallback either', () => {
      // The broker renders a "you may close this window" page in this case, so
      // undefined must stay undefined rather than becoming an error.
      const result = resolveBrokerRedirectUrl({ allowedOrigins: [BRANCH_WILDCARD] });
      expect(result.redirectUrl).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('does not warn even when the site has no registered origins', () => {
      const result = resolveBrokerRedirectUrl({
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('a proposal that matches a registered origin is honoured', () => {
    it('accepts a proposal on a registered branch wildcard', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe('https://live-mysite.pantheonsite.io/p1');
      expect(result.warning).toBeUndefined();
    });

    // One wildcard covers every environment, including future multidevs.
    it('accepts any environment prefix under one registered wildcard', () => {
      for (const env of ['live', 'dev', 'test', 'my-multidev']) {
        const proposed = 'https://' + env + '-mysite.pantheonsite.io/p1';
        const result = resolveBrokerRedirectUrl({
          proposedRedirectUrl: proposed,
          fallbackRedirectUrl: FALLBACK,
          allowedOrigins: [BRANCH_WILDCARD],
        });
        expect(result.redirectUrl).toBe(proposed);
      }
    });

    it('accepts a proposal on an exactly registered custom domain', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://www.client.com/p1/editor',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: ['https://www.client.com'],
      });
      expect(result.redirectUrl).toBe('https://www.client.com/p1/editor');
    });

    it('preserves the proposal path and query, matching on origin only', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1/editor?doc=7',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe('https://live-mysite.pantheonsite.io/p1/editor?doc=7');
    });
  });

  describe('a proposal that does not match falls back and warns', () => {
    it('rejects an unregistered origin', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://evil.example/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('https://evil.example');
    });

    // The fail-open trap: buildCorsPatterns returns wildcard-all for an empty
    // array, and every site's array is empty today.
    it('rejects every proposal when the site has no registered origins', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('rejects every proposal when the origin lookup returned null', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: null,
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    // A legacy '*' row predates phase 1's write validation; expanding it would
    // authorise any redirect at all.
    it('never honours a proposal on the strength of a legacy bare wildcard', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://evil.example/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: ['*'],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('rejects a protocol-less legacy row rather than treating it as a host', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: ['*-mysite.pantheonsite.io'],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('rejects an unparseable proposal', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'not-a-url',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    // URL() resolves the host to evil.com — why .origin is compared, not the raw string.
    it('rejects a proposal that hides an attacker host in userinfo', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io@evil.com/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('rejects a scheme downgrade to http on a registered https origin', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'http://live-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('rejects a sibling host that the registered wildcard does not cover', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-othersite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('does not treat a registered apex as covering its www sibling', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://www.client.com/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: ['https://client.com'],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });
  });

  describe('localhost is gated by environment, not allowed unconditionally', () => {
    // isOriginAllowed short-circuits localhost before consulting any pattern;
    // inheriting that would let a production login redirect to a local server.
    it('refuses a localhost proposal in production', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'http://localhost:3000/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
        environment: 'production',
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('refuses 127.0.0.1 in production as well', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'http://127.0.0.1:8787/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
        environment: 'production',
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });

    it('allows a localhost proposal in local development', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'http://localhost:3000/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [],
        environment: 'local',
      });
      expect(result.redirectUrl).toBe('http://localhost:3000/p1');
      expect(result.warning).toBeUndefined();
    });

    // sbx1/sandbox are deployed and internet-reachable, so a localhost proposal
    // there is an unvalidated redirect target on a public endpoint.
    it.each(['sbx1', 'sandbox', 'staging'])(
      'refuses a localhost proposal on the deployed %s environment',
      (environment) => {
        const result = resolveBrokerRedirectUrl({
          proposedRedirectUrl: 'http://localhost:3000/p1',
          fallbackRedirectUrl: FALLBACK,
          allowedOrigins: [],
          environment,
        });
        expect(result.redirectUrl).toBe(FALLBACK);
        expect(result.warning).toBeDefined();
      },
    );

    it('refuses a localhost proposal on sbx1 even when origins are registered', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'http://localhost:3000/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
        environment: 'sbx1',
      });
      expect(result.redirectUrl).toBe(FALLBACK);
    });

    // An unset binding must not quietly widen what a deployed worker accepts.
    it('treats an unknown environment as production for this purpose', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'http://localhost:3000/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe(FALLBACK);
      expect(result.warning).toBeDefined();
    });
  });

  // Storing the raw string while checking a normalised origin leaves a parser
  // differential a consumer could resolve differently than we checked.
  describe('the stored value is the one that was validated', () => {
    it('normalises backslashes rather than storing them raw', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https:\\\\live-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe('https://live-mysite.pantheonsite.io/p1');
      expect(result.redirectUrl).not.toContain('\\');
    });

    // '//p1' is a legitimately distinct path, so it is preserved. What matters is
    // that an odd path cannot carry the redirect off-site.
    it('keeps an unusual path but pins the origin to the validated one', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io//evil.example/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBeDefined();
      expect(new URL(result.redirectUrl ?? '').origin).toBe(
        'https://live-mysite.pantheonsite.io',
      );
    });

    it('lowercases the host, since that is what was matched', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://LIVE-mysite.pantheonsite.io/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe('https://live-mysite.pantheonsite.io/p1');
    });

    it('keeps path and query intact while normalising', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://live-mysite.pantheonsite.io/p1/editor?doc=7',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.redirectUrl).toBe('https://live-mysite.pantheonsite.io/p1/editor?doc=7');
    });
  });

  describe('the warning is safe to surface', () => {
    it('names the rejected origin so the failure is diagnosable', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://evil.example/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.warning).toContain('https://evil.example');
    });

    // Returned in a JSON body, so it must not carry reflectable markup.
    it('contains no markup characters', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://evil.example/<script>alert(1)</script>',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: [BRANCH_WILDCARD],
      });
      expect(result.warning).toBeDefined();
      expect(result.warning).not.toContain('<');
      expect(result.warning).not.toContain('>');
    });

    it('does not leak the registered origins back to the caller', () => {
      const result = resolveBrokerRedirectUrl({
        proposedRedirectUrl: 'https://evil.example/p1',
        fallbackRedirectUrl: FALLBACK,
        allowedOrigins: ['https://secret-internal-host.pantheon.io'],
      });
      expect(result.warning).not.toContain('secret-internal-host');
    });
  });
});
