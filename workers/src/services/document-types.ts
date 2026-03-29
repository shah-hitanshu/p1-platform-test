/**
 * Document Service - Types, Interfaces, and Error Classes
 *
 * All shared types, error classes, and helper/mapper functions
 * used by document-service.ts and branch-document-service.ts.
 */

import type { Document } from '../types';

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
}

/**
 * Database row format for documents with inherited flag and publish state.
 */
export interface DocumentOnBranchRow extends DocumentRow {
  inherited: boolean;
  published_version_id: string | null;
  published_at: string | null;
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
}

/**
 * Options for listing documents on a branch.
 */
export interface ListDocumentsOnBranchOptions {
  pathPrefix?: string;
  mainBranchId?: string;
}

/**
 * Parameters for creating a document on a branch.
 */
export interface CreateDocumentOnBranchParams {
  siteId: string;
  branchId: string;
  path: string;
  snapshot?: Record<string, unknown>;
  createdById: string;
  createdByType: 'user' | 'agent';
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
  deletedByType: 'user' | 'agent';
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
  createdByType: 'user' | 'agent' | 'system';
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
  created_by_type: 'user' | 'agent' | 'system';
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
  if (row.archived_at !== null) {
    doc.archivedAt = row.archived_at;
  }
  return doc;
}

/**
 * Validates document path format.
 * - Must not be empty
 * - Must not start with /
 * - Must not end with /
 * - Must not contain path traversal sequences
 *
 * @throws InvalidDocumentPathError if path is invalid
 */
export function validatePath(path: string): void {
  if (!path || path.trim() === '') {
    throw new InvalidDocumentPathError('path cannot be empty');
  }
  if (path.startsWith('/')) {
    throw new InvalidDocumentPathError('path cannot start with /');
  }
  if (path.endsWith('/')) {
    throw new InvalidDocumentPathError('path cannot end with /');
  }
  // Check for path traversal attempts
  if (path.includes('..')) {
    throw new InvalidDocumentPathError('path cannot contain traversal sequences');
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
