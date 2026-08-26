/**
 * Phase 3.1: Service Exports
 *
 * Central export point for all service modules.
 */

// Shared error hierarchy — see errors.ts for why each error carries its own status.
export {
  HttpError,
  SiteNotFoundError,
  DocumentNotFoundError,
  BranchNotFoundError,
  SourceBranchNotFoundError,
  TargetBranchNotFoundError,
  OrganizationNotFoundError,
  AgentNotFoundError,
  StructureNotFoundError,
  NodeNotFoundError,
  MergeRequestNotFoundError,
  CheckpointNotFoundError,
  TemplateNotFoundError,
  MigrationJobNotFoundError,
  GrantNotFoundError,
  VersionNotFoundError,
  RestoreVersionNotFoundError,
  CanonicalVersionNotFoundError,
  QueryNotFoundError,
  DatasourceNotFoundError,
  DocumentVersionNotFoundError,
  BranchStructureStateNotFoundError,
  DocumentMetadataNotFoundError,
  PageConflictError,
  DuplicateDocumentPathError,
  DocumentPathConflictError,
  DuplicateStructureSlugError,
  DuplicateNodeSlugError,
  DuplicateAgentNameError,
  DuplicateAgentIdError,
  DuplicateBranchNameError,
  CannotDeleteMergedRequestError,
  OrganizationHasSitesError,
  OrganizationHasActiveSitesError,
  DuplicateGrantError,
  LegacyConflictDeltaError,
  ConflictAlreadyResolvedError,
  DuplicatePantheonSiteIdError,
  TranslationAlreadyExistsError,
  DatasourceInUseError,
  MergeConflictsError,
  InvalidSlugError,
  InvalidDocumentPathError,
  InvalidAgentParamsError,
  InvalidMergeRequestParamsError,
  InvalidBranchParamsError,
  InvalidCheckpointParamsError,
  InvalidOrganizationParamsError,
  InvalidDocumentVersionParamsError,
  InvalidSiteParamsError,
  InvalidSettingsError,
  InvalidLocaleError,
  InvalidBodyError,
  InvalidVersionRangeError,
  UnsupportedStrategyError,
  ManualResolutionError,
  CircularReferenceError,
  InvalidMergeRequestStatusTransitionError,
  TargetBranchNotMainError,
  MainBranchProtectionError,
  InvalidBranchStatusTransitionError,
  MainBranchOnlyError,
  NoMergeBaseError,
  SelfNestingMoveError,
  ImmovableDocumentError,
  MergeNotAllowedError,
  AuthorityOverrideLimitError,
  SchemaValidationError,
  MaxPresencesExceededError,
  SyncError,
  MergeExecutionError,
  VersionReconstructionError,
  DatabaseError,
} from './errors';

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
  resolveDocumentByPath,
  updateDocumentPath,
  updateDocumentFields,
  deleteDocument,
  listDocuments,
  documentExists,
  countDocumentsByLocale,
  archiveDocument,
  restoreDocument,
  // Branch-scoped document operations
  listDocumentsOnBranch,
  listTemplatesOnBranch,
  createDocumentOnBranch,
  documentExistsOnBranch,
  isTombstonedOnBranch,
  deleteDocumentOnBranch,
  deleteDocumentWithRedirect,
} from './document-service';

export type {
  CreateDocumentParams,
  ListDocumentsOptions,
  DocumentWithArchive,
  DocumentResolution,
  DocumentOnBranch,
  // Branch-scoped document types
  ListDocumentsOnBranchOptions,
  CreateDocumentOnBranchParams,
  CreateDocumentOnBranchResult,
  DeleteDocumentOnBranchParams,
  DeleteDocumentWithRedirectParams,
  DeleteDocumentWithRedirectResult,
  MoveResult,
} from './document-service';

// Document Relations Service
export {
  getEdgeBySource,
  getLocalizationEdgeBySource,
  listLocalizationEdgesByTarget,
  listDriftCandidates,
  createLocalizationEdge,
  getAuthorityOverrides,
  getAuthorityOverride,
  authorityOverridesToJson,
  setAuthorityOverride,
  MAX_OVERRIDE_ENTRIES,
  clearAuthorityOverride,
} from './relations-service';

export type {
  DocumentRelation,
  CreateLocalizationEdgeParams,
  DriftCandidate,
  DriftCandidatePage,
  Authority,
  AuthorityOverrides,
  AuthorityOverridesJson,
} from './relations-service';

// Create-translation Service
export {
  createTranslation,
  listLocaleVariants,
} from './create-translation-service';

export type {
  CreateTranslationParams,
  CreateTranslationResult,
  LocaleVariantsResult,
  LocalizationEdgeSummary,
} from './create-translation-service';

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
  hasTombstoneAfterVersion,
  getLatestVersionsForBranch,
  listDocumentVersions,
  getDocumentVersionByNumber,
  getLatestDocumentVersionWithFallback,
  getLatestTemplateVersionWithFallback,
  reconstructVersionSnapshot,
  restoreDocumentVersion,
} from './document-version-service';

export type {
  CreateDocumentVersionParams,
  ListDocumentVersionsOptions,
  DocumentVersionWithFallback,
  RestoreDocumentVersionParams,
} from './document-version-service';

// Checkpoint Service
export {
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  getDocumentsAtCheckpoint,
  getDocumentAtCheckpoint,
  resolveCheckpointDocuments,
  resolveCheckpointDeletions,
  revertToCheckpoint,
  deleteCheckpoint,
  getLatestCheckpoint,
  getCheckpointDocumentCount,
  getStructureAtCheckpoint,
  // Enhanced checkpoint functions (Agent Politeness)
  updateCheckpointStatus,
  listCheckpointsByAgent,
  listCheckpointsByOperationType,
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
  normalizeSlug,
} from './structure-service';

export type {
  CreateStructureParams,
  UpdateBranchStructureParams,
  ListStructuresOptions,
  ListBranchStructuresOptions,
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

// Edit Permission Service
export { EditPermissionService } from './edit-permission-service';

export type {
  EditPermissionContext,
  EditPermission,
  GetAgentStatusFn,
  EditPermissionServiceOptions,
} from './edit-permission-service';

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
} from './presence-rollup-service';

// Branch Invalidation Service
export { writeBranchInvalidation, getBranchVersion } from './branch-invalidation-service';

// Site Settings Service
export {
  getSiteSettings,
  updateSiteSettings,
  getEffectiveCacheTtl,
} from './site-settings-service';

export type {
  SiteSettings,
  SiteSettingsUpdate,
  EffectiveSiteSettings,
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
  extractUpstreamDelta,
  getMigrationJob,
  listMigrationConflicts,
  resolveMigrationConflict,
} from './migration-service';

export type {
  MigrationPrincipal,
  MigrationJob,
  MigrationConflict,
  MigrationDelta,
  UpstreamDelta,
  PropPatch,
  DocumentWithSnapshot,
  ConflictResult,
} from './migration-service';

export { buildPageMetadata } from './page-metadata-service';

// Localization Enforcement Service
export { resolveSlotAuthorityDefaults } from './localization-enforcement-service';

export type { SlotAuthorityDefaults } from './localization-enforcement-service';

// Change Summary Service
export { buildChangeSummary, isChangeRelationType } from './change-summary-service';

export type {
  ChangeSummary,
  ChangeSummaryEntry,
  ChangeClassification,
  ChangeRelationType,
  BuildChangeSummaryParams,
} from './change-summary-service';

// Branch Drift Service
export {
  listBranchDrift,
  DEFAULT_DRIFT_LIMIT,
  MAX_DRIFT_LIMIT,
} from './branch-drift-service';

export type {
  BranchDriftEntry,
  BranchDriftPage,
  ListBranchDriftOptions,
} from './branch-drift-service';

export type {
  SlotDelta,
  SlotAdd,
  SlotMove,
  SlotPlacement,
  SlotZone,
} from './slot-delta';

// Datasource Service
export {
  getDatasource,
  listDatasources,
  createLocalDatasource,
  deleteDatasource,
} from './datasource-service';

export type {
  CreateLocalDatasourceParams,
  DeleteDatasourceParams,
} from './datasource-service';

// Query Service
export {
  getQuery,
  listQueries,
  createQuery,
  deleteQuery,
  executeQuery,
} from './query-service';

export type {
  CreateQueryParams,
  DeleteQueryParams,
  ExecuteQueryParams,
} from './query-service';

// Template Hooks
export { onTemplateCreated } from './template-hooks';

export type { OnTemplateCreatedParams, OnTemplateCreatedResult } from './template-hooks';

// Path Change Service
export { getPathChangesSince } from './path-change-service';
export type { PathChange } from './path-change-service';

// Move operations
export { moveDocumentOnBranch } from './branch-document-service';
export { moveDocumentGlobally } from './document-service';
