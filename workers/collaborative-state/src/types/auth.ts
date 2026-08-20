/**
 * Collaborative State System - Authorization and Identity Types
 *
 * Roles, permissions, grants, guest links, approval requests,
 * and authenticated principal types.
 */

import type {
  AgentSiteRole,
  ApprovalRequestStatus,
  GuestLinkStatus,
  PantheonRole,
  RoleName,
  AuthProvider,
} from './enums';

// =============================================================================
// Authorization Types
// =============================================================================

/**
 * Permissions available to each role level.
 */
export interface RolePermissions {
  canView: boolean;
  canEdit: boolean;
  canCreateBranch: boolean;
  canEditDocuments: boolean;
  canCreateCheckpoint: boolean;
  canProposeMerge: boolean;
  canMerge: boolean;
  canMergeToMain: boolean;
  canManageGrants: boolean;
  /**
   * Authoring the structures other documents inherit from: template CRUD and
   * migration, writes to `_registry/templates/*`, and the drift listing that
   * surfaces them. Distinct from canEditDocuments, which governs editing a
   * document's own content.
   */
  canManageTemplates: boolean;
}

/**
 * Role definition with name and associated permissions.
 */
export interface Role {
  name: RoleName;
  permissions: RolePermissions;
}

/**
 * Elevates an actor's permissions on a specific branch.
 */
export interface BranchGrant {
  id: string;
  branchId: string;
  actorId: string;
  actorType: 'user' | 'agent';
  role: RoleName;
  grantedById: string;
  grantedByType: 'user' | 'agent';
  grantedAt: string;
  reason?: string;
}

/**
 * Magic link for view-only branch access.
 * Guests can access without a Pantheon account.
 */
export interface GuestLink {
  id: string;
  branchId: string;
  email: string;
  name?: string;
  tokenHash: string;
  status: GuestLinkStatus;
  expiresAt: string;
  createdById: string;
  createdByType: 'user' | 'agent';
  createdAt: string;
  message?: string;
  accessCount: number;
  lastAccessAt?: string;
}

/**
 * Tracks approval requests for merge requests.
 */
export interface ApprovalRequest {
  id: string;
  mergeRequestId: string;
  approverEmail: string;
  approverName?: string;
  tokenHash?: string;
  status: ApprovalRequestStatus;
  expiresAt?: string;
  respondedAt?: string;
  comment?: string;
  createdAt: string;
}

// =============================================================================
// Identity Types
// =============================================================================

/**
 * Pre-validated identity from Pantheon Identity Service.
 */
export interface AuthenticatedPrincipal {
  id: string;
  type: 'user' | 'agent' | 'service';
  email?: string;
  /** Display name from the identity provider */
  name?: string;
  /** Profile picture URL from the identity provider */
  avatarUrl?: string;
  organizationId?: string;
  pantheonSiteRoles: Record<string, PantheonRole>;
  tokenExpiry: string;
  scopes?: string[];
  /** Which auth provider validated this principal */
  authProvider?: AuthProvider;
  /** Original subject ID from the OAuth provider (before UUIDv5 mapping) */
  providerSubjectId?: string;
  /** Database users.id (may differ from id which is a provider-derived UUIDv5) */
  dbUserId?: string;
  /** Site ID this principal is scoped to (for service/site_token principals) */
  siteId?: string;
  /** System-level role from the users allowlist ('admin' or 'member') */
  systemRole?: string;
  /** Acting user ID forwarded from MCP server (agent principals only) */
  actingUserId?: string;
  /** Acting user email forwarded from MCP server (agent principals only) */
  actingUserEmail?: string;
  /** Acting user display name forwarded from MCP server (agent principals only) */
  actingUserName?: string;
}

/**
 * AI agent identity with capabilities and site access.
 */
export interface AgentIdentity {
  id: string;
  organizationId: string;
  name: string;
  capabilities: string[];
  siteAccess: Record<string, AgentSiteRole>;
}

/**
 * Test user for local development.
 */
export interface MockUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  siteRoles: Record<string, PantheonRole>;
}

/**
 * Test agent for local development.
 */
export interface MockAgent {
  id: string;
  name: string;
  apiKey: string; // Unhashed for local testing
  siteRoles: Record<string, AgentSiteRole>;
}

/**
 * Configuration for mock identity provider.
 */
export interface MockIdentityConfig {
  tokenExpiry?: string;
  users: MockUser[];
  agents: MockAgent[];
  defaultSiteRoles: Record<string, PantheonRole>;
}
