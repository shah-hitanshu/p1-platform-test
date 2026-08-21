/**
 * Role Catalog
 *
 * The default role sets for the P1 platform, with display labels for UIs.
 *
 * USER_ROLES and AGENT_ROLES are the roles a UI should offer when granting
 * access. Owner is deliberately absent from USER_ROLES — site ownership is
 * managed through the platform, not handed out from a role picker — but
 * remains grantable through the API, so the GRANTABLE_* lists used for
 * endpoint validation are supersets of the catalogs.
 */

import type { PantheonRole, AgentSiteRole } from '../types';

export interface RoleOption<T extends string> {
  value: T;
  label: string;
}

const USER_ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  team_member: 'Team Member',
  author: 'Author',
  editor: 'Editor',
} satisfies Record<PantheonRole, string>;

const AGENT_ROLE_LABELS = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
} satisfies Record<AgentSiteRole, string>;

export const GRANTABLE_USER_ROLES = Object.keys(
  USER_ROLE_LABELS,
) as readonly PantheonRole[];

export const USER_ROLES: readonly RoleOption<PantheonRole>[] =
  GRANTABLE_USER_ROLES.filter((value) => value !== 'owner').map((value) => ({
    value,
    label: USER_ROLE_LABELS[value],
  }));

export const GRANTABLE_AGENT_ROLES = Object.keys(
  AGENT_ROLE_LABELS,
) as readonly AgentSiteRole[];

export const AGENT_ROLES: readonly RoleOption<AgentSiteRole>[] =
  GRANTABLE_AGENT_ROLES.map((value) => ({
    value,
    label: AGENT_ROLE_LABELS[value],
  }));
