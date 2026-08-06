import type { AuthenticatedPrincipal } from '../../src/types';

/** `id` and `type` are required: a principal's identity is never a default. */
type PrincipalOverrides = Partial<AuthenticatedPrincipal> &
  Pick<AuthenticatedPrincipal, 'id' | 'type'>;

/**
 * Builds an `AuthenticatedPrincipal` for a handler under test.
 *
 * Only two fields are defaulted, and both are load-bearing enough to name here:
 *
 * - `pantheonSiteRoles: {}` — `authorization.ts` indexes this unguarded, so an
 *   empty object means "no role on this site" rather than "throws". A test that
 *   exercises an authorization path should pass roles explicitly rather than
 *   inherit that decision.
 * - `tokenExpiry` — far future, because `src` only forwards it and never
 *   compares it against now. A test covering expiry has to set it.
 */
export function makePrincipal(overrides: PrincipalOverrides): AuthenticatedPrincipal {
  const principal: AuthenticatedPrincipal = {
    id: overrides.id,
    type: overrides.type,
    pantheonSiteRoles: {},
    tokenExpiry: '2099-01-01T00:00:00.000Z',
  };

  // Copy descriptors rather than spreading: a spread invokes any getter in
  // `overrides` and stores its result, silently freezing a read the caller
  // deliberately deferred to a value that does not exist yet.
  return Object.defineProperties(principal, Object.getOwnPropertyDescriptors(overrides));
}
