import { describe, it, expect } from 'vitest';
import { isServicePrincipalAllowed, SCOPE_RULES } from '../../src/auth/service-principal';
import type { AuthenticatedPrincipal } from '../../src/types';

describe('Service Principal Scope Enforcement (Phase 3)', () => {
  function createServicePrincipal(
    siteId: string,
    scopes: string[] = ['read:published'],
  ): AuthenticatedPrincipal {
    return {
      id: 'token-uuid-123',
      type: 'service',
      pantheonSiteRoles: {},
      tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
      scopes,
      siteId,
      authProvider: 'site_token',
    };
  }

  // =========================================================================
  // read:published scope
  // =========================================================================

  describe('read:published scope', () => {
    it('should allow GET on content handler with main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', true);
      expect(result.allowed).toBe(true);
    });

    it('should deny GET on content handler with non-main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient scope');
    });

    it('should allow GET on content handler when branchIsMain is undefined (defaults to main)', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', undefined);
      expect(result.allowed).toBe(true);
    });

    it('should deny GET on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient scope');
    });

    it('should deny GET on branches handler', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'branches', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny POST on content handler', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST', 'content', true);
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // read:all scope
  // =========================================================================

  describe('read:all scope', () => {
    it('should allow GET on content handler with main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', true);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on content handler with non-main branch', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on branches handler', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'branches', true);
      expect(result.allowed).toBe(true);
    });

    it('should deny POST on content handler', () => {
      const principal = createServicePrincipal('site-123', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST', 'content', true);
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // read:draft scope
  // =========================================================================

  describe('read:draft scope', () => {
    it('should allow GET on content handler with any branch', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(true);
    });

    it('should allow GET on branches handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'branches', true);
      expect(result.allowed).toBe(true);
    });

    it('should deny POST on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'POST', 'documents', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny DELETE on documents handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'DELETE', 'documents', true);
      expect(result.allowed).toBe(false);
    });

    it('should deny PATCH on content handler', () => {
      const principal = createServicePrincipal('site-123', ['read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'PATCH', 'content', true);
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // Non-service principals pass through
  // =========================================================================

  describe('non-service principals', () => {
    it('should always allow user principals regardless of handler or method', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'user-uuid',
        type: 'user',
        email: 'alice@example.com',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
        authProvider: 'google',
      };
      const result = isServicePrincipalAllowed(principal, 'any-site', 'POST', 'documents', false);
      expect(result.allowed).toBe(true);
    });

    it('should always allow agent principals', () => {
      const principal: AuthenticatedPrincipal = {
        id: 'agent-uuid',
        type: 'agent',
        pantheonSiteRoles: {},
        tokenExpiry: new Date(Date.now() + 86400000).toISOString(),
        authProvider: 'mock',
      };
      const result = isServicePrincipalAllowed(principal, 'any-site', 'DELETE', 'documents', true);
      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // Multiple scopes
  // =========================================================================

  describe('multiple scopes', () => {
    it('should allow access if any scope permits the operation', () => {
      const principal = createServicePrincipal('site-123', ['read:published', 'read:all']);
      // read:published blocks non-main, but read:all allows it
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'content', false);
      expect(result.allowed).toBe(true);
    });

    it('should allow documents GET if read:draft is among scopes', () => {
      const principal = createServicePrincipal('site-123', ['read:published', 'read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-123', 'GET', 'documents', true);
      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // Site scoping (unchanged behavior)
  // =========================================================================

  describe('site scoping with new signature', () => {
    it('should deny access when siteId does not match', () => {
      const principal = createServicePrincipal('site-123', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-456', 'GET', 'content', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('site');
    });
  });

  // =========================================================================
  // read:all scope: includes site-export
  // =========================================================================
  describe('read:all scope — site-export access', () => {
    it('allows GET on site-export handler', () => {
      const principal = createServicePrincipal('site-1', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'site-export');
      expect(result.allowed).toBe(true);
    });

    it('denies POST on site-export handler (read-only scope)', () => {
      const principal = createServicePrincipal('site-1', ['read:all']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'site-export');
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // write:registry scope — PCC registry CI sync (§0)
  // =========================================================================
  describe('write:registry scope', () => {
    it('allows POST on documents handler', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'documents');
      expect(result.allowed).toBe(true);
    });

    it('allows POST on documents handler on a non-main branch', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'documents', false);
      expect(result.allowed).toBe(true);
    });

    it('denies GET on documents handler (write-only scope)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'documents');
      expect(result.allowed).toBe(false);
    });

    it('denies DELETE on documents handler', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'DELETE', 'documents');
      expect(result.allowed).toBe(false);
    });

    it('denies POST on content handler', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'content');
      expect(result.allowed).toBe(false);
    });

    it('denies POST on branches handler', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'branches');
      expect(result.allowed).toBe(false);
    });

    it('denies POST on grants handler (privilege escalation guard)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'grants');
      expect(result.allowed).toBe(false);
    });

    it('denies POST on site-import handler (does not inherit write:create behavior)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'site-import');
      expect(result.allowed).toBe(false);
    });

    // =======================================================================
    // §0 Phase 2: GET on branches — needed so the CI sync script can match
    // the pushed git branch's name to a CCR branch. Added as an independent
    // clause (not folded into the POST/documents clause) so it can't also
    // legalize GET+documents or POST+branches as a cross-product side effect.
    // =======================================================================

    it('allows GET on branches handler (branch-name resolution for CI sync)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'branches');
      expect(result.allowed).toBe(true);
    });

    it('allows GET on branches handler on a non-main branch', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'branches', false);
      expect(result.allowed).toBe(true);
    });

    it('still denies GET on documents handler (branches read does not imply document read)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'documents');
      expect(result.allowed).toBe(false);
    });

    it('still denies GET on content handler', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'content');
      expect(result.allowed).toBe(false);
    });

    it('still denies GET on site-export handler', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'site-export');
      expect(result.allowed).toBe(false);
    });

    it('still denies POST on branches handler (GET clause does not grant branch creation)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'branches');
      expect(result.allowed).toBe(false);
    });
  });

  // =========================================================================
  // write:registry combined with another scope on the same token (§0 Phase 2
  // regression coverage — a prior review round caught a bug where write:registry's
  // deny-by-default guard wrongly blocked GET requests legitimately authorized by
  // a different scope on the same token; the coarse-gate level must not repeat that)
  // =========================================================================
  describe('write:registry combined with read:draft on one token', () => {
    it('allows GET on documents handler via the read:draft clause', () => {
      const principal = createServicePrincipal('site-1', ['write:registry', 'read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'documents');
      expect(result.allowed).toBe(true);
    });

    it('still allows POST on documents handler via the write:registry clause', () => {
      const principal = createServicePrincipal('site-1', ['write:registry', 'read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'documents');
      expect(result.allowed).toBe(true);
    });

    it('still denies POST on branches handler (neither scope grants branch creation)', () => {
      const principal = createServicePrincipal('site-1', ['write:registry', 'read:draft']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'branches');
      expect(result.allowed).toBe(false);
    });

    // Reviewer finding (PCC-3430, document-api.ts's deny-by-default guard):
    // that guard assumes "no other scope currently grants POST+documents"
    // and — unlike branch-api.ts's equivalent guard for GET+branches — does
    // NOT check isAllowedByAnotherScope before denying. That's true today
    // (asserted below) and is exactly why the guard doesn't need the check:
    // a combined-scope token can never legitimately need it, since nothing
    // else grants this method+handler pair. If this test ever starts
    // failing, a new scope has been given POST+documents, and
    // document-api.ts's guard MUST be updated to check
    // isAllowedByAnotherScope (mirroring branch-api.ts's pattern) before
    // that scope ships — otherwise a token combining it with write:registry
    // will be wrongly 403'd, the same bug class this PR already fixed once
    // for the branches case.
    it('canary: no scope other than write:registry currently grants POST on the documents handler', () => {
      const otherScopesGrantingPostDocuments = Object.entries(SCOPE_RULES)
        .filter(([scope]) => scope !== 'write:registry')
        .filter(([, rules]) =>
          rules.some(
            (rule) => rule.methods.includes('POST') && rule.allowedHandlers !== '*' && rule.allowedHandlers.includes('documents'),
          ),
        )
        .map(([scope]) => scope);

      expect(otherScopesGrantingPostDocuments).toEqual([]);
    });
  });

  // =========================================================================
  // Test 35: write:create scope — limited to migration endpoints only
  // =========================================================================
  describe('write:create scope (Test 35)', () => {
    it('allows GET on site-export handler', () => {
      const principal = createServicePrincipal('site-1', ['write:create']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'site-export');
      expect(result.allowed).toBe(true);
    });

    it('allows POST on site-import handler', () => {
      const principal = createServicePrincipal('site-1', ['write:create']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'site-import');
      expect(result.allowed).toBe(true);
    });

    it('denies POST on grants handler (privilege escalation guard)', () => {
      const principal = createServicePrincipal('site-1', ['write:create']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'grants');
      expect(result.allowed).toBe(false);
    });

    it('denies DELETE on any handler', () => {
      const principal = createServicePrincipal('site-1', ['write:create']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'DELETE', 'site-import');
      expect(result.allowed).toBe(false);
    });

    it('denies POST on documents handler', () => {
      const principal = createServicePrincipal('site-1', ['write:create']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'POST', 'documents');
      expect(result.allowed).toBe(false);
    });
  });
  // =========================================================================
  // Editor boot: site metadata + templates reads
  // =========================================================================
  describe('editor boot reads on templates and site metadata', () => {
    for (const scope of ['read:all', 'read:draft']) {
      it(`allows GET on templates handler with ${scope}`, () => {
        const principal = createServicePrincipal('site-1', [scope]);
        expect(isServicePrincipalAllowed(principal, 'site-1', 'GET', 'templates', false).allowed).toBe(true);
      });

      it(`allows GET on sites handler with ${scope}`, () => {
        const principal = createServicePrincipal('site-1', [scope]);
        expect(isServicePrincipalAllowed(principal, 'site-1', 'GET', 'sites').allowed).toBe(true);
      });

      for (const method of ['POST', 'PATCH', 'DELETE']) {
        it(`denies ${method} on templates handler with ${scope}`, () => {
          const principal = createServicePrincipal('site-1', [scope]);
          expect(isServicePrincipalAllowed(principal, 'site-1', method, 'templates').allowed).toBe(false);
        });

        it(`denies ${method} on sites handler with ${scope}`, () => {
          const principal = createServicePrincipal('site-1', [scope]);
          expect(isServicePrincipalAllowed(principal, 'site-1', method, 'sites').allowed).toBe(false);
        });
      }
    }

    it('still denies templates and site metadata for read:published', () => {
      const principal = createServicePrincipal('site-1', ['read:published']);
      expect(isServicePrincipalAllowed(principal, 'site-1', 'GET', 'templates').allowed).toBe(false);
      expect(isServicePrincipalAllowed(principal, 'site-1', 'GET', 'sites').allowed).toBe(false);
    });

    it('names the method, handler, and token scopes when denying', () => {
      const principal = createServicePrincipal('site-1', ['read:published']);
      const result = isServicePrincipalAllowed(principal, 'site-1', 'GET', 'templates');
      expect(result.reason).toContain('GET');
      expect(result.reason).toContain('templates');
      expect(result.reason).toContain('read:published');
    });
  });
});
