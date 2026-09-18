/**
 * Site members: the people and agents who can be mentioned on a site.
 */

export type SiteMemberRole = 'owner' | 'admin' | 'developer' | 'team_member' | 'author' | 'editor';

export type AgentSiteRole = 'viewer' | 'editor' | 'admin';

export interface SiteMemberUser {
  id: string;
  /** Null for someone granted access who has never signed in. */
  name: string | null;
  email: string | null;
  role: SiteMemberRole;
  avatar: string | null;
}

export interface SiteMemberAgent {
  id: string;
  name: string;
  role: AgentSiteRole;
  /** Agents carry no stored image; derive one from the id. */
  avatar: null;
  /** True when the agent reaches every site rather than being granted this one. */
  isGlobal: boolean;
}

export interface SiteMembers {
  members: SiteMemberUser[];
  agents: SiteMemberAgent[];
}
