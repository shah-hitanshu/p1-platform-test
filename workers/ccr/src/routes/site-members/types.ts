/**
 * The wire contract of GET /api/sites/{siteId}/members — the part clients are
 * coupled to. Member and agent shapes are the service's, re-exported so a
 * client need not reach past the route. Row shapes stay next to their SQL.
 */

import type { AuthenticatedPrincipal } from '../../types';
import type { MASClient } from '../../services/mas-client';

export type {
  MembersRosterSource,
  SiteMemberAgent,
  SiteMemberSource,
  SiteMemberUser,
} from '../../services/site-members-service';

import type { SiteMemberAgent, SiteMemberUser } from '../../services/site-members-service';

export interface SiteMembersResponse {
  members: SiteMemberUser[];
  agents: SiteMemberAgent[];
}

export interface SiteMembersRouteContext {
  siteId: string;
  principal: AuthenticatedPrincipal;
  masClient?: MASClient;
}
