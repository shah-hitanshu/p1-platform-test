/**
 * @pantheon-systems/css-client
 *
 * TypeScript API client for Pantheon's P1 content platform.
 */

// Main client
export { P1Client } from './client.js';
export type { P1ClientConfig } from './client.js';

// Shared constants
export { PRODUCTION_BASE_URL } from './constants.js';

// Types
export type {
  // Core domain types
  Site,
  Branch,
  BranchStatus,
  Document,
  DocumentVersion,
  DocumentVersionSource,
  Checkpoint,
  CheckpointType,
  CheckpointStatus,
  CheckpointDocument,
  WorkflowSettings,
  // Puck types
  PuckData,
  PuckComponentData,
  PuckRootData,
  // API types
  Principal,
  PaginationOptions,
  CreateBranchParams,
  CreateDocumentParams,
  CreateDocumentVersionParams,
  CreateCheckpointParams,
  PublishDocumentResult,
  ListDocumentsOptions,
  // Presence types
  ActorState,
  ActorRole,
  ActorPresence,
  DocumentPresenceSummary,
  BranchPresenceSummary,
  BranchPresence,
  SitePresence,
  AgentPresenceLocation,
  AgentGlobalPresence,
  // Agent registry types
  AgentStatus,
  AgentSettings,
  RegisteredAgent,
  CreateAgentParams,
  UpdateAgentParams,
  ListAgentsOptions,
  // Agent edit types
  AgentTrigger,
  AgentEditDenialReason,
  AgentEditContext,
  AgentEditPermission,
  AgentEditSession,
  AgentEditCompleteResult,
  AgentEditAbortResult,
  AgentStopResult,
  // Focus region types
  UpdateFocusRegionsResponse,
  // Publish types
  PublishResult,
  // Merge types
  ConflictResolutionStrategy,
  MergeRequestStatus,
  DocumentConflictType,
  DocumentConflict,
  ConflictDetails,
  MergeabilityResult,
  DocumentDiff,
  MergePreview,
  MergeExecuteParams,
  MergeExecuteResult,
  MergeRequest,
  CreateMergeRequestParams,
  UpdateMergeRequestParams,
  ListMergeRequestsOptions,
  ExecuteMergeRequestOptions,
  // Template types
  Template,
  TemplateSummary,
  TemplateMetadata,
  TemplateContentItem,
  TemplateRootProps,
  CreateTemplateParams,
  UpdateTemplateParams,
  // Migration types
  MigrationJob,
  MigrationConflict,
  MigrationPreview,
  MigrationPreviewDocument,
  TriggerMigrationParams,
  // Datasource & Query types
  Datasource,
  QuerySortField,
  Query,
  QueryResultItem,
  QueryResultsMeta,
  QueryResults,
  QueryResultsParams,
  // Site settings types
  LocalePolicy,
  SiteLocales,
  SiteSettings,
  SiteSettingsResult,
  // Localization types
  TranslationMode,
  LocalizationRelation,
  CreateTranslationParams,
  CreateTranslationResult,
  TranslationVariant,
  ListTranslationsResult,
  PropAuthority,
  AuthorityOverridesMap,
  AuthorityOverridesResult,
  // Relation / upstream-diff types
  ChangeClassification,
  ChangeSummaryEntry,
  ChangeSummary,
  UpstreamResolutions,
  UpstreamResolutionTarget,
  // Site member types
  SiteMemberRole,
  AgentSiteRole,
  SiteMemberUser,
  SiteMemberAgent,
  SiteMembers,
} from './types/index.js';
export type * from './types/threads/index.js';

// Auth utilities and role types
export {
  createApiKeyAuth,
  createTokenAuth,
  InMemoryTokenStorage,
  LocalStorageTokenStorage,
} from './auth.js';
export type { AuthProvider, TokenStorage, RoleName, RolePermissions, ViewerRole } from './auth.js';

// OAuth utilities
export {
  createOAuthAuthProvider,
  validateToken,
  loginMockUser,
} from './oauth.js';
export type {
  OAuthUserInfo,
  OAuthSession,
  AuthMeResponse,
} from './oauth.js';

// Broker authentication
export { createBrokerAuth, brokerLogout, hasPendingBrokerLogin, redeemPendingBrokerLogin } from './broker.js';
export type { BrokerAuthConfig, BrokerLogoutConfig, BrokerRedeemConfig, BrokerRedeemResult, LogoutOutcome } from './broker.js';

// Errors
export {
  P1ApiError,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  SessionExpiredError,
  MissingParameterError,
} from './errors.js';

// Content delivery (read-only)
export { P1ContentClient } from './content.js';
export type {
  P1ContentClientConfig,
  PageContent,
  SeoMetadata,
  PageListEntry,
  PageListResult,
  RedirectInfo,
} from './content.js';

// Real-time collaboration
export { RealtimeClient } from './realtime.js';
export type { RealtimeClientConfig, ConnectionParams } from './realtime.js';
