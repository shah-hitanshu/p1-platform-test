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
  listSites,
  DuplicatePantheonSiteIdError,
  InvalidSiteParamsError,
} from './site-service';

export type {
  CreateSiteParams,
  UpdateSiteParams,
  ListSitesOptions,
} from './site-service';

// Document Service
export {
  createDocument,
  getDocument,
  getDocumentByPath,
  updateDocumentPath,
  deleteDocument,
  listDocuments,
  documentExists,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
} from './document-service';

export type {
  CreateDocumentParams,
  ListDocumentsOptions,
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
  isValidStatusTransition,
  // Note: SiteNotFoundError is already exported from document-service
  // Import directly from branch-service if you need the branch-specific error class
  BranchNotFoundError,
  DuplicateBranchNameError,
  InvalidBranchParamsError,
  MainBranchProtectionError,
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
  getLatestVersionsForBranch,
  listDocumentVersions,
  getDocumentVersionByNumber,
  DocumentNotFoundError,
  InvalidDocumentVersionParamsError,
} from './document-version-service';

export type {
  CreateDocumentVersionParams,
  ListDocumentVersionsOptions,
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
  // Note: BranchNotFoundError is already exported from branch-service
  CheckpointNotFoundError,
  InvalidCheckpointParamsError,
} from './checkpoint-service';

export type {
  CreateCheckpointParams,
  CreateCheckpointResult,
  ListCheckpointsOptions,
  RevertToCheckpointParams,
  RevertToCheckpointResult,
  CheckpointDocumentVersion,
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
