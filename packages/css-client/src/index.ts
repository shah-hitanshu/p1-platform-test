/**
 * @pantheon-systems/css-client
 *
 * TypeScript API client for the Collaborative State System.
 */

// Main client
export { CSSClient } from './client.js';
export type { CSSClientConfig } from './client.js';

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
} from './types.js';

// Auth utilities
export {
  createApiKeyAuth,
  createTokenAuth,
  InMemoryTokenStorage,
  LocalStorageTokenStorage,
} from './auth.js';
export type { AuthProvider, TokenStorage } from './auth.js';

// OAuth utilities
export {
  createGoogleOAuth,
  createAuth0OAuth,
  createCSSAuthServerOAuth,
  createOAuthAuthProvider,
  validateToken,
  loginMockUser,
  generateCodeVerifier,
  computeS256Challenge,
  generateState,
} from './oauth.js';
export type {
  GoogleOAuthConfig,
  Auth0OAuthConfig,
  CSSAuthServerOAuthConfig,
  OAuthUserInfo,
  OAuthSession,
  AuthMeResponse,
} from './oauth.js';

// Errors
export {
  CSSApiError,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  SessionExpiredError,
} from './errors.js';

// Content delivery (read-only)
export { CSSContentClient } from './content.js';
export type {
  CSSContentClientConfig,
  PageContent,
  PageListEntry,
  PageListResult,
} from './content.js';

// Real-time collaboration
export { RealtimeClient } from './realtime.js';
export type { RealtimeClientConfig, ConnectionParams } from './realtime.js';
