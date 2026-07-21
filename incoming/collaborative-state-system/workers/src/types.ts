/**
 * Collaborative State System - Core TypeScript Types
 *
 * Barrel re-export from domain-grouped modules.
 * All existing imports from './types' continue to work unchanged.
 *
 * @see collaborative-state-system-architecture-v2.3.md
 */

export type {
  ActorType,
  PantheonRole,
  AgentSiteRole,
  RoleName,
  BranchStatus,
  CheckpointType,
  DocumentVersionSource,
  MergeRequestStatus,
  ApprovalRequestStatus,
  GuestLinkStatus,
  MergeApprovalMode,
  ApproverMode,
  ConflictResolutionStrategy,
  StructureType,
  NodeType,
  SchemaEnforcementMode,
  EditOperationType,
  CheckpointTrigger,
  CheckpointStatus,
  AgentStatus,
  PresenceState,
  AuthProvider,
  DocumentConflictType,
  StructureConflictType,
  MigrationJobStatus,
  MigrationResolution,
} from './types/enums';

export type {
  WorkflowSettings,
  AgentPriorityTier,
  OrganizationSettings,
  Organization,
  AgentSettings,
  RegisteredAgent,
  Site,
  SiteScreenshot,
  SiteScreenshotStatus,
  Branch,
  Document,
  DocumentVersion,
  Checkpoint,
  DocumentConflict,
  StructureMergeConflict,
  ConflictDetails,
  MergeRequest,
  MigrationJob,
  MigrationConflict,
} from './types/domain';

export type {
  RolePermissions,
  Role,
  BranchGrant,
  GuestLink,
  ApprovalRequest,
  AuthenticatedPrincipal,
  AgentIdentity,
  MockUser,
  MockAgent,
  MockIdentityConfig,
} from './types/auth';

export type {
  SiteStructure,
  StructureNode,
  BranchStructureState,
  BranchDocumentMetadata,
  SchemaValidationError,
  NonConformingDocument,
  SchemaValidationResult,
  EditOperation,
  ConnectionMeta,
} from './types/structures';

export type {
  AuditActor,
  AuditResource,
  AuditEvent,
} from './types/audit';

export type {
  ActorPresence,
  AgentEditContext,
  AgentEditPermission,
  PresenceSummary,
  DocumentPresenceSummary,
  BranchPresence,
  BranchPresenceSummary,
  SitePresence,
  AgentPresenceLocation,
  AgentGlobalPresence,
} from './types/presence';
