/**
 * Phase 1.1: CRDT Sync Service
 *
 * Service for syncing Durable Object CRDT state to PostgreSQL and loading
 * CRDT state from PostgreSQL for DO initialization.
 *
 * This enables:
 * 1. Durability: DO state is persisted to PostgreSQL for disaster recovery
 * 2. Merge support: merge-crdt strategy can access CRDT state from document_versions
 * 3. State continuity: DOs can initialize from PostgreSQL if their local storage is empty
 */

import type { DocumentVersion } from '../types';
import { getDocument } from './document-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
} from './document-version-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for syncing CRDT state to PostgreSQL.
 */
export interface SyncCrdtToPostgresParams {
  /** The site ID (for validation) */
  siteId: string;
  /** The document UUID */
  documentId: string;
  /** The branch ID */
  branchId: string;
  /** The current document snapshot (JSON representation) */
  snapshot: Record<string, unknown>;
  /** Base64-encoded CRDT state from Y.encodeStateAsUpdate() */
  crdtState: string;
  /** The actor performing the sync */
  actorId: string;
  /** Type of actor (user or agent) */
  actorType: 'user' | 'agent';
}

/**
 * Result of loading CRDT state from PostgreSQL.
 */
export interface LoadCrdtStateResult {
  /** The document snapshot */
  snapshot: Record<string, unknown>;
  /** Base64-encoded CRDT state (undefined if version has no CRDT state) */
  crdtState: string | undefined;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when the document is not found for a sync operation.
 */
export class DocumentNotFoundError extends Error {
  public readonly name = 'DocumentNotFoundError';

  constructor(public readonly documentId: string) {
    super(`Document with ID "${documentId}" not found.`);
    Object.setPrototypeOf(this, DocumentNotFoundError.prototype);
  }
}

/**
 * Error thrown when a sync operation fails.
 */
export class SyncError extends Error {
  public readonly name = 'SyncError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Sync CRDT state from a Durable Object to PostgreSQL.
 *
 * This creates a new document version with source='realtime' containing
 * both the JSON snapshot and the binary CRDT state.
 *
 * Deduplication is handled by createDocumentVersion in document-version-service.ts,
 * which skips creating a new version if the snapshot is identical to the latest.
 *
 * @param params - Sync parameters
 * @returns The created or existing document version
 * @throws DocumentNotFoundError if the document doesn't exist or doesn't belong to the site
 */
export async function syncCrdtToPostgres(
  params: SyncCrdtToPostgresParams,
): Promise<DocumentVersion> {
  // Look up the document by ID
  const document = await getDocument(params.documentId);

  if (document === null) {
    throw new DocumentNotFoundError(params.documentId);
  }

  // Verify the document belongs to the specified site (security check)
  if (document.siteId !== params.siteId) {
    throw new DocumentNotFoundError(params.documentId);
  }

  // Create a new document version with the CRDT state
  // Deduplication is handled by createDocumentVersion
  const version = await createDocumentVersion({
    documentId: document.id,
    branchId: params.branchId,
    snapshot: params.snapshot,
    crdtState: params.crdtState,
    source: 'realtime',
    createdById: params.actorId,
    createdByType: params.actorType,
  });

  return version;
}

/**
 * Load the latest CRDT state from PostgreSQL for a document on a branch.
 *
 * This is used by Durable Objects to initialize their state when they
 * have no local storage (e.g., after eviction or first access).
 *
 * @param siteId - The site ID (for validation)
 * @param documentId - The document UUID
 * @param branchId - The branch ID
 * @returns The snapshot and CRDT state, or null if not found
 */
export async function loadLatestCrdtState(
  siteId: string,
  documentId: string,
  branchId: string,
): Promise<LoadCrdtStateResult | null> {
  // Look up the document by ID
  const document = await getDocument(documentId);

  if (document === null) {
    return null;
  }

  // Verify the document belongs to the specified site (security check)
  if (document.siteId !== siteId) {
    return null;
  }

  // Get the latest version on this branch
  const version = await getLatestDocumentVersion(document.id, branchId);

  if (version === null) {
    return null;
  }

  return {
    snapshot: version.snapshot,
    crdtState: version.crdtState,
  };
}
