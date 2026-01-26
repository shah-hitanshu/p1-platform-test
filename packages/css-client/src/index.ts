/**
 * @pantheon/css-client
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
  ListDocumentsOptions,
} from './types.js';

// Auth utilities
export {
  createApiKeyAuth,
  createTokenAuth,
  InMemoryTokenStorage,
  LocalStorageTokenStorage,
} from './auth.js';
export type { AuthProvider, TokenStorage } from './auth.js';

// Errors
export {
  CSSApiError,
  NetworkError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from './errors.js';

// Real-time collaboration
export { RealtimeClient } from './realtime.js';
export type { RealtimeClientConfig, ConnectionParams } from './realtime.js';
