/**
 * PCC-3457: normalize principal ids before stamping app.users.principal_id.
 *
 * app.users.principal_id is the lookup key that the persistence actor
 * resolver (persistence-actor-service.ts) queries by UUIDv5
 * (providerSubToUuid('auth0', <full raw subject>)). The login and bootstrap
 * paths historically stamped principal.id verbatim; for broker-authenticated
 * principals that is the raw OAuth subject (`google-oauth2|…`), producing
 * rows the resolver can never match (incident PCC-3464; existing rows
 * backfilled by migration 045). Normalizing at the stamping sites keeps
 * every writer of principal_id on the single convention the readers use:
 *
 * - uuid ids           -> unchanged (auth0-provider principals already carry
 *                         the UUIDv5 of their subject as principal.id)
 * - `provider|subject` -> providerSubToUuid('auth0', id), the resolver's
 *                         exact lookup key
 * - other ids          -> unchanged (legacy/test/mock identifiers)
 *
 * The classification mirrors resolveActor's — the two must not diverge, or
 * a stamped row becomes unreachable by the resolver again.
 */

import { providerSubToUuid } from './uuid-v5';
import { UUID_RE } from '../utils/branch-ref';

export async function normalizePrincipalIdForDb(id: string): Promise<string> {
  if (UUID_RE.test(id) || !id.includes('|')) {
    return id;
  }
  return providerSubToUuid('auth0', id);
}
