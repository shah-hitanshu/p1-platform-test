/**
 * Document Service - Types, Interfaces, and Error Classes
 *
 * All shared types, error classes, and helper/mapper functions
 * used by document-service.ts and branch-document-service.ts.
 */

import type { AuthenticatedPrincipal, Document } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new document.
 */
export interface CreateDocumentParams {
  siteId: string;
  path: string;
}

/**
 * Options for listing documents.
 */
export interface ListDocumentsOptions {
  limit?: number;
  offset?: number;
  pathPrefix?: string;
  /** Filter by archived status: true = only archived, false = only non-archived, undefined = non-archived (default) */
  archived?: boolean;
}

/**
 * Database row format for documents.
 */
export interface DocumentRow {
  id: string;
  site_id: string;
  path: string;
  created_at: string;
  archived_at: string | null;
  template_id?: string | null;
  template_version?: number | null;
}

/**
 * Database row format for documents with inherited flag and publish state.
 */
export interface DocumentOnBranchRow extends DocumentRow {
  inherited: boolean;
  published_version_id: string | null;
  published_at: string | null;
  snapshot_title: string | null;
  latest_version_at: string | null;
  last_modified_by_id: string | null;
  last_modified_by_type: string | null;
}

/**
 * Extended document type with archivedAt field.
 */
export interface DocumentWithArchive extends Document {
  archivedAt?: string;
}

/**
 * Extended document type with inherited flag and publish state for branch listings.
 */
export interface DocumentOnBranch extends DocumentWithArchive {
  inherited: boolean;
  isPublished: boolean;
  publishedVersionId?: string;
  publishedAt?: string;
  snapshotTitle?: string;
  updatedAt?: string;
  lastModifiedById?: string;
  lastModifiedByType?: string;
}

/**
 * Options for listing documents on a branch.
 */
export interface ListDocumentsOnBranchOptions {
  pathPrefix?: string;
  mainBranchId?: string;
  templateId?: string;
  limit?: number;
  offset?: number;
  orderBy?: {
    field: 'path' | 'createdAt';
    direction: 'asc' | 'desc';
  };
}

/**
 * Parameters for creating a document on a branch.
 */
export interface CreateDocumentOnBranchParams {
  siteId: string;
  branchId: string;
  path: string;
  snapshot?: Record<string, unknown>;
  templateId?: string | null;
  templateVersion?: number | null;
  createdById: string;
  createdByType: 'user' | 'agent' | 'service' | 'system';
}

/**
 * Result of creating a document on a branch.
 */
export interface CreateDocumentOnBranchResult {
  document: Document;
  version: DocumentVersion;
}

/**
 * Parameters for deleting a document on a branch (tombstone).
 */
export interface DeleteDocumentOnBranchParams {
  documentId: string;
  branchId: string;
  deletedById: string;
  deletedByType: 'user' | 'agent' | 'service';
}

/**
 * Document version type for internal use.
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  source: string;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system' | 'service';
  createdAt: string;
}

/**
 * Database row format for document versions.
 */
export interface DocumentVersionRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  source: string;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system' | 'service';
  created_at: string;
  is_tombstone?: boolean;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when attempting to create a document for a non-existent site.
 */
export class SiteNotFoundError extends Error {
  public readonly name = 'SiteNotFoundError';

  constructor(public readonly siteId: string) {
    super(`Site with ID "${siteId}" not found.`);
    Object.setPrototypeOf(this, SiteNotFoundError.prototype);
  }
}

/**
 * Error thrown when attempting to create a document with a duplicate path.
 */
export class DuplicateDocumentPathError extends Error {
  public readonly name = 'DuplicateDocumentPathError';

  constructor(
    public readonly path: string,
    public readonly siteId?: string,
  ) {
    super(`A document with path "${path}" already exists in this site.`);
    Object.setPrototypeOf(this, DuplicateDocumentPathError.prototype);
  }
}

/**
 * Error thrown when document path is invalid.
 */
export class InvalidDocumentPathError extends Error {
  public readonly name = 'InvalidDocumentPathError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidDocumentPathError.prototype);
  }
}

/**
 * Error thrown when document is not found.
 */
export class DocumentNotFoundError extends Error {
  public readonly name = 'DocumentNotFoundError';

  constructor(public readonly documentId: string) {
    super(`Document with ID "${documentId}" not found.`);
    Object.setPrototypeOf(this, DocumentNotFoundError.prototype);
  }
}

/**
 * Error thrown when restoring a document but the path is occupied.
 */
export class DocumentPathConflictError extends Error {
  public readonly name = 'DocumentPathConflictError';

  constructor(public readonly path: string) {
    super(`Path "${path}" is occupied by another document.`);
    Object.setPrototypeOf(this, DocumentPathConflictError.prototype);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Checks if a database row represents a tombstone (deleted document version).
 */
export function isTombstoneRow(row: { is_tombstone?: boolean }): boolean {
  return row.is_tombstone === true;
}

// =============================================================================
// write:registry scope helpers (§0)
//
// Shared by src/routes/document-api.ts, src/routes/branch-api.ts, and
// src/services/branch-document-service.ts — kept in one place so the
// definition of "a registry path" and "a registry-scoped service principal"
// can't drift between the routes and services layers.
// =============================================================================

export const REGISTRY_COMPONENTS_PREFIX = '_registry/components/';
// Matches puck-css-integration's INDEX_PATH constant (packages/puck-css/src/editor/utils/syncComponentRegistry.ts) —
// keep the two in sync if either changes.
export const REGISTRY_INDEX_PATH = '_registry/index';

export function isRegistryWritePath(path: string): boolean {
  return path.startsWith(REGISTRY_COMPONENTS_PREFIX) || path === REGISTRY_INDEX_PATH;
}

export function isRegistryScopedServicePrincipal(principal: AuthenticatedPrincipal): boolean {
  return principal.type === 'service' && (principal.scopes?.includes('write:registry') ?? false);
}

/**
 * Maps a database row to a DocumentOnBranch domain object.
 */
export function mapRowToDocumentOnBranch(row: DocumentOnBranchRow): DocumentOnBranch {
  const doc = mapRowToDocument(row) as DocumentOnBranch;
  doc.inherited = row.inherited;
  doc.isPublished = row.published_version_id !== null;
  if (row.published_version_id !== null) {
    doc.publishedVersionId = row.published_version_id;
  }
  if (row.published_at !== null) {
    doc.publishedAt = row.published_at;
  }
  if (row.snapshot_title !== null) {
    doc.snapshotTitle = row.snapshot_title;
  }
  if (row.latest_version_at !== null) {
    doc.updatedAt = row.latest_version_at;
  }
  if (row.last_modified_by_id !== null) {
    doc.lastModifiedById = row.last_modified_by_id;
  }
  if (row.last_modified_by_type !== null) {
    doc.lastModifiedByType = row.last_modified_by_type;
  }
  return doc;
}

/**
 * Maps a database row to a Document domain object.
 */
export function mapRowToDocument(row: DocumentRow): DocumentWithArchive {
  const doc: DocumentWithArchive = {
    id: row.id,
    siteId: row.site_id,
    path: row.path,
    createdAt: row.created_at,
  };
  if (row.template_id !== null && row.template_id !== undefined) {
    doc.templateId = row.template_id;
  }
  if (row.template_version !== null && row.template_version !== undefined) {
    doc.templateVersion = row.template_version;
  }
  if (row.archived_at !== null) {
    doc.archivedAt = row.archived_at;
  }
  return doc;
}

// Maximum path length to prevent DoS attacks
const MAX_PATH_LENGTH = 1024;

/**
 * Normalizes a document path to a consistent format.
 * - Strips leading and trailing slashes
 * - Collapses multiple consecutive slashes
 * - Converts backslashes to forward slashes
 * - "/" becomes "" (root path)
 * - Preserves internal structure
 *
 * Examples:
 * - "/" → ""
 * - "/example" → "example"
 * - "example/" → "example"
 * - "/example/" → "example"
 * - "pages/home" → "pages/home"
 * - "pages//home" → "pages/home"
 * - "pages\\home" → "pages/home"
 *
 * @param path - The path to normalize
 * @returns The normalized path
 * @throws InvalidDocumentPathError if path is empty, whitespace-only, or too long
 */
export function normalizePath(path: string): string {
  let normalized = path.trim();

  // Empty string represents root path "/"
  if (normalized === '') {
    return '/';
  }


  if (normalized.length > MAX_PATH_LENGTH) {
    throw new InvalidDocumentPathError(
      `path length exceeds maximum of ${String(MAX_PATH_LENGTH)} characters`,
    );
  }

  if (normalized === '/') {
    return '/';
  }

  // Convert to lowercase for case-insensitive matching
  normalized = normalized.toLowerCase();

  // Convert backslashes to forward slashes for consistent path separators
  normalized = normalized.replace(/\\/g, '/');

  // Collapse multiple consecutive slashes into single slash
  normalized = normalized.replace(/\/+/g, '/');

  // If the path is just "/" (root path), return it as-is
  if (normalized === '/') {
    return '/';
  }

  // Remove leading slashes
  while (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }

  // Remove trailing slashes
  while (normalized.endsWith('/') && normalized.length > 0) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Validates a normalized document path.
 * - "/" is the root path and is always valid
 * - Must not contain path traversal sequences
 * - Must not contain NULL bytes or control characters
 * - Must not contain internal whitespace
 *
 * Note: This function expects a normalized path (use normalizePath first).
 *
 * @param normalizedPath - The normalized path to validate
 * @throws InvalidDocumentPathError if path contains invalid characters or sequences
 */
export function validatePath(normalizedPath: string): void {
  if (normalizedPath === '') {
    throw new InvalidDocumentPathError('path cannot be empty');
  }


  // Root path "/" is always valid
  if (normalizedPath === '/') {
    return;
  }

  // Check for NULL bytes (potential injection attack)
  if (normalizedPath.includes('\0')) {
    throw new InvalidDocumentPathError(
      'path cannot contain NULL bytes',
    );
  }

  // Check for control characters (0x00-0x1F and 0x7F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(normalizedPath)) {
    throw new InvalidDocumentPathError(
      'path cannot contain control characters',
    );
  }

  // Check for internal whitespace in segments
  // Allow leading dots for hidden files, but reject whitespace-only or whitespace in middle
  const segments = normalizedPath.split('/');
  for (const seg of segments) {
    if (seg.trim() !== seg || seg.includes(' ') || seg.includes('\t')) {
      throw new InvalidDocumentPathError(
        'path segments cannot contain whitespace',
      );
    }
  }

  // Check for path traversal attempts by validating segments
  // Only reject ".." or "." as complete path segments, not as part of filenames
  // This allows filenames like "file..name" while blocking "pages/../etc"
  if (segments.some((seg) => seg === '..' || seg === '.')) {
    throw new InvalidDocumentPathError(
      'path cannot contain traversal sequences',
    );
  }
}

/**
 * Escapes LIKE pattern special characters in a string.
 * PostgreSQL LIKE treats % as wildcard (any chars) and _ as single char.
 * Backslashes must be escaped first to avoid double-escaping.
 */
export function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Checks if an error is a PostgreSQL unique constraint violation.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23505'
  );
}

/**
 * Checks if an error is a PostgreSQL foreign key violation.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23503'
  );
}

/**
 * Maps a database row to a DocumentVersion object.
 */
export function mapRowToDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    source: row.source,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
  };
}
