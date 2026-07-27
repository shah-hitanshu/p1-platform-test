/**
 * Phase 3.1: Service Exports
 *
 * Central export point for all service modules.
 */

// Site Service
export {
  createSite,
  getSite,
  getSiteByPantheonId,
  updateSite,
  deleteSite,
  archiveSite,
  restoreSite,
  listSites,
  DuplicatePantheonSiteIdError,
  InvalidSiteParamsError,
} from './site-service';

export type {
  CreateSiteParams,
  UpdateSiteParams,
  ListSitesOptions,
} from './site-service';

// Site Screenshot Service
export {
  upsertSiteScreenshot,
  getSiteScreenshot,
  listSitesNeedingScreenshotRefresh,
} from './site-screenshot-service';

export type {
  UpsertSiteScreenshotParams,
  ListSitesNeedingScreenshotRefreshOptions,
  SiteNeedingScreenshotRefresh,
} from './site-screenshot-service';

// Document Service
export {
  createDocument,
  getDocument,
  getDocumentByPath,
  updateDocumentPath,
  deleteDocument,
  listDocuments,
  documentExists,
  archiveDocument,
  restoreDocument,
  // Branch-scoped document operations
  listDocumentsOnBranch,
  listTemplatesOnBranch,
  createDocumentOnBranch,
  documentExistsOnBranch,
  deleteDocumentOnBranch,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
} from './document-service';

export type {
  CreateDocumentParams,
  ListDocumentsOptions,
  DocumentWithArchive,
  DocumentOnBranch,
  // Branch-scoped document types
  ListDocumentsOnBranchOptions,
  CreateDocumentOnBranchParams,
  CreateDocumentOnBranchResult,
  DeleteDocumentOnBranchParams,
} from './document-service';

// Branch Service
export {
  createBranch,
  createMainBranch,
  getBranch,
  getBranchByName,
  getMainBranch,
  listBranches,
  updateBranch,
  updateBranchStatus,
  deleteBranch,
  archiveBranch,
  restoreBranch,
  isValidStatusTransition,
  // Note: SiteNotFoundError is already exported from document-service
  // Import directly from branch-service if you need the branch-specific error class
  BranchNotFoundError,
  DuplicateBranchNameError,
  InvalidBranchParamsError,
  MainBranchProtectionError,
  MainBranchOnlyError,
  InvalidBranchStatusTransitionError,
  DatabaseError,
} from './branch-service';

export type {
  CreateBranchParams,
  CreateMainBranchParams,
  UpdateBranchParams,
  ListBranchesOptions,
} from './branch-service';

// Document Version Service
export {
  createDocumentVersion,
  getDocumentVersion,
  getLatestDocumentVersion,
  getLatestPublishedDocumentVersion,
  getLatestVersionsForBranch,
  listDocumentVersions,
  getDocumentVersionByNumber,
  getLatestDocumentVersionWithFallback,
  getLatestTemplateVersionWithFallback,
  reconstructVersionSnapshot,
  // Note: DocumentNotFoundError already exported from document-service
  InvalidDocumentVersionParamsError,
} from './document-version-service';

export type {
  CreateDocumentVersionParams,
  ListDocumentVersionsOptions,
  DocumentVersionWithFallback,
} from './document-version-service';

// Checkpoint Service
export {
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  getDocumentsAtCheckpoint,
  getDocumentAtCheckpoint,
  revertToCheckpoint,
  deleteCheckpoint,
  getLatestCheckpoint,
  getCheckpointDocumentCount,
  getStructureAtCheckpoint,
  // Enhanced checkpoint functions (Agent Politeness)
  updateCheckpointStatus,
  listCheckpointsByAgent,
  listCheckpointsByOperationType,
  // Note: BranchNotFoundError is already exported from branch-service
  CheckpointNotFoundError,
  InvalidCheckpointParamsError,
  publishDocument,
} from './checkpoint-service';

export type {
  CreateCheckpointParams,
  CreateCheckpointResult,
  ListCheckpointsOptions,
  RevertToCheckpointParams,
  RevertToCheckpointResult,
  CheckpointDocumentVersion,
  CheckpointStructure,
  // Enhanced checkpoint types (Agent Politeness)
  ListCheckpointsByAgentOptions,
  PublishDocumentParams,
  PublishDocumentResult,
} from './checkpoint-service';

// Merge Request Service
export {
  createMergeRequest,
  getMergeRequest,
  listMergeRequests,
  updateMergeRequest,
  updateMergeRequestStatus,
  updateMergeRequestConflicts,
  deleteMergeRequest,
  isValidStatusTransition as isValidMergeRequestStatusTransition,
  MergeRequestNotFoundError,
  InvalidMergeRequestParamsError,
  InvalidMergeRequestStatusTransitionError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  CannotDeleteMergedRequestError,
  TargetBranchNotMainError,
} from './merge-request-service';

export type {
  CreateMergeRequestParams,
  UpdateMergeRequestParams,
  ListMergeRequestsOptions,
  MergeMetadata,
} from './merge-request-service';

// Merge Base Service
export {
  findMergeBase,
  getModifiedDocumentsSince,
  getDocumentsAtCheckpoint as getMergeBaseDocumentsAtCheckpoint,
  getBranchLineage,
  SourceBranchNotFoundError as MergeBaseSourceBranchNotFoundError,
  TargetBranchNotFoundError as MergeBaseTargetBranchNotFoundError,
} from './merge-base-service';

export type {
  MergeBase,
  ModifiedDocument,
  CheckpointDocument as MergeBaseCheckpointDocument,
  BranchInLineage,
  GetModifiedDocumentsOptions,
} from './merge-base-service';

// Conflict Detection Service
export {
  detectConflicts,
  checkMergeability,
  NoMergeBaseError,
} from './conflict-detection-service';

export type {
  ConflictDetectionResult,
  MergeabilityResult,
} from './conflict-detection-service';

// Conflict Resolution Service
export {
  resolveConflict,
  resolveAllConflicts,
  resolveDeletedConflict,
  VersionNotFoundError,
  UnsupportedStrategyError,
} from './conflict-resolution-service';

export type {
  ResolveConflictParams,
  ConflictResolutionResult,
  ConflictWithVersions,
  ResolveAllConflictsParams,
  ResolveAllConflictsResult,
  ResolveDeletedConflictParams,
  DeletedConflictResolutionResult,
} from './conflict-resolution-service';

// Merge Execution Service
export {
  executeMerge,
  executeMergeWithResolution,
  previewMerge,
  MergeNotAllowedError,
  MergeConflictsError,
  MergeExecutionError,
} from './merge-execution-service';

export type {
  ExecuteMergeParams,
  ExecuteMergeResult,
  ExecuteMergeWithResolutionParams,
  ExecuteMergeWithResolutionResult,
  MergePreview,
  PreviewMergeOptions,
} from './merge-execution-service';

// Structure Service
export {
  createStructure,
  getStructure,
  getStructureBySlug,
  listStructures,
  updateStructure,
  deleteStructure,
  // Branch-scoped structure functions
  getBranchStructure,
  getBranchStructureBySlug,
  listBranchStructures,
  updateBranchStructure,
  deleteBranchStructure,
  createNode,
  getNode,
  listNodes,
  updateNode,
  deleteNode,
  moveNode,
  reorderNodes,
  buildNavigationTree,
  // Note: SiteNotFoundError is already exported from document-service
  StructureNotFoundError,
  NodeNotFoundError,
  DuplicateStructureSlugError,
  DuplicateNodeSlugError,
  CircularReferenceError,
  InvalidSlugError,
  normalizeSlug,
} from './structure-service';

export type {
  CreateStructureParams,
  UpdateStructureParams,
  ListStructuresOptions,
  CreateNodeParams,
  UpdateNodeParams,
  ListNodesOptions,
  MoveNodeParams,
  NavigationTreeNode,
} from './structure-service';

// Metadata Service
export {
  getBranchStructureState,
  createBranchStructureState,
  updateBranchStructureState,
  deleteBranchStructureState,
  getDocumentMetadata,
  setDocumentMetadata,
  deleteDocumentMetadata,
  listDocumentMetadata,
  validateMetadata,
  validateAllDocuments,
  getSchemaValidationSummary,
  BranchStructureStateNotFoundError,
  DocumentMetadataNotFoundError,
  SchemaValidationError,
} from './metadata-service';

export type {
  BranchStructureState,
  DocumentMetadata,
  ValidationError,
  MetadataValidationResult,
  CreateBranchStructureStateParams,
  UpdateBranchStructureStateParams,
  SetDocumentMetadataParams,
  ListDocumentMetadataOptions,
  NonConformingDocument,
  SchemaValidationResult,
  SchemaValidationSummary,
} from './metadata-service';

// Grant Service
export {
  createGrant,
  getGrant,
  listGrants,
  deleteGrant,
  GrantNotFoundError,
  DuplicateGrantError,
} from './grant-service';

export type {
  Grant,
  CreateGrantParams,
  ListGrantsOptions,
} from './grant-service';

// Document Diff Service
export {
  computeJsonDiff,
  computeDocumentDiff,
  computeDocumentDiffs,
  DocumentVersionNotFoundError,
} from './document-diff-service';

export type {
  DiffOperation,
  DocumentDiff,
  ComputedDiff,
} from './document-diff-service';

// Metrics Service
export {
  initializeMetrics,
  incrementCounter,
  recordTiming,
  setGauge,
  flushMetrics,
  getMetricsBuffer,
  normalizePathPattern,
  classifyError,
  getStatusClass,
} from './metrics-service';

export type {
  MetricLabels,
  MetricsConfig,
  MetricPoint,
} from './metrics-service';

// CRDT Sync Service
export {
  syncCrdtToPostgres,
  loadLatestCrdtState,
  DocumentNotFoundError as CrdtSyncDocumentNotFoundError,
  SyncError,
} from './crdt-sync-service';

export type {
  SyncCrdtToPostgresParams,
  LoadCrdtStateResult,
} from './crdt-sync-service';

// Organization Service
export {
  createOrganization,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
  archiveOrganization,
  restoreOrganization,
  listOrganizations,
  linkSiteToOrganization,
  unlinkSiteFromOrganization,
  getSitesByOrganization,
  getOrganizationForSite,
  InvalidOrganizationParamsError,
  OrganizationHasSitesError,
  OrganizationHasActiveSitesError,
  OrganizationNotFoundError,
} from './organization-service';

export type {
  CreateOrganizationParams,
  UpdateOrganizationParams,
  ListOrganizationsOptions,
} from './organization-service';

// Agent Service
export {
  createAgent,
  getAgentById,
  getAgentByName,
  updateAgent,
  updateAgentStatus,
  deleteAgent,
  listAgents,
  getAgentsByOrganization,
  getActiveAgentCount,
  InvalidAgentParamsError,
  DuplicateAgentNameError,
  OrganizationNotFoundError as AgentOrganizationNotFoundError,
  AgentNotFoundError,
} from './agent-service';

export type {
  CreateAgentParams,
  UpdateAgentParams,
  ListAgentsOptions,
  GetAgentsByOrganizationOptions,
} from './agent-service';

// Presence Service
export {
  PresenceManager,
  regionsOverlap,
  MAX_PRESENCES,
  MaxPresencesExceededError,
} from './presence-service';

export type { RegisterPresenceOptions } from './presence-service';

// Activity Detection Service
export {
  ActivityDetector,
  DEFAULT_IDLE_TIMEOUT_MS,
  MAX_ACTIVE_REGIONS,
} from './activity-detection-service';

export type {
  ActivityDetectorOptions,
  AgentProceedContext,
  AgentProceedResult,
  ActivityDetectorState,
} from './activity-detection-service';

// Agent Edit Permission Service
export { AgentEditPermissionService } from './agent-edit-permission-service';

export type {
  AgentEditContext,
  AgentEditPermission,
  GetAgentStatusFn,
  AgentEditPermissionServiceOptions,
} from './agent-edit-permission-service';

// Agent Context Service (Phase 7.1)
export {
  parseAgentContext,
  hasAgentContext,
  validateAgentContext,
  MAX_AGENT_ID_LENGTH,
  MAX_INTENT_LENGTH,
  MAX_OPERATION_TYPE_LENGTH,
  MAX_TARGET_REGIONS,
  MAX_REGION_PATH_LENGTH,
} from './agent-context-service';

export type {
  AgentContext,
  AgentContextValidationResult,
} from './agent-context-service';

// Presence Rollup Service (Phase 8)
export {
  getBranchPresence,
  getSitePresence,
  getAgentPresence,
  queryDocumentPresence,
  BranchNotFoundError as PresenceRollupBranchNotFoundError,
  SiteNotFoundError as PresenceRollupSiteNotFoundError,
  AgentNotFoundError as PresenceRollupAgentNotFoundError,
} from './presence-rollup-service';

// Branch Invalidation Service
export { writeBranchInvalidation, getBranchVersion } from './branch-invalidation-service';

// Site Settings Service
export {
  getSiteSettings,
  updateSiteSettings,
  getEffectiveCacheTtl,
  InvalidSettingsError,
} from './site-settings-service';

export type {
  SiteSettings,
  EnvDefaults,
} from './site-settings-service';

// Migration Service (PROPOSAL-010 Phase 5)
export {
  triggerMigration,
  findAffectedDocuments,
  detectDocumentConflicts,
  applyDeltaToDocument,
  rollbackMigration,
  processMigration,
  extractTemplateDelta,
  getMigrationJob,
  listMigrationConflicts,
  resolveMigrationConflict,
  TemplateNotFoundError,
  MigrationJobNotFoundError,
  InvalidVersionRangeError,
} from './migration-service';

export type {
  MigrationPrincipal,
  MigrationJob,
  MigrationConflict,
  MigrationDelta,
  PropPatch,
  DocumentWithSnapshot,
  ConflictResult,
} from './migration-service';

export { buildPageMetadata } from './page-metadata-service';

export type {
  SlotDelta,
  SlotAdd,
  SlotMove,
  SlotPlacement,
  SlotZone,
} from './slot-delta';
