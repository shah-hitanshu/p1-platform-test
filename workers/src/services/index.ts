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
