/**
 * Phase 1.1: CRDT Sync Service
 *
 * Service for syncing Durable Object CRDT state to PostgreSQL and loading
 * CRDT state from PostgreSQL for DO initialization.
 *
 * This enables:
 * 1. Durability: DO state is persisted to PostgreSQL for disaster recovery
 * 2. Merge support: document state can be reconstructed from PostgreSQL
 * 3. State continuity: DOs can initialize from PostgreSQL if their local storage is empty
 */

import type { DocumentVersion, DocumentVersionSource } from '../types';
import { query } from '../db';
import { getDocument } from './document-service';
import {
  createDocumentVersion,
  getLatestDocumentVersion,
  getLatestPublishedDocumentVersion,
  reconstructVersionSnapshot,
} from './document-version-service';
import { getBranch } from './branch-service';
import { enforceUniqueSlotIds } from './slot-id-backstop';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for the consolidated single-query sync (Phase 5.2).
 * Unlike SyncCrdtToPostgresParams, this does NOT require siteId because
 * document existence validation is handled at the DO level.
 */
export interface ConsolidatedSyncParams {
  /** The document UUID */
  documentId: string;
  /** The branch ID */
  branchId: string;
  /** The current document snapshot (JSON representation) */
  snapshot: Record<string, unknown>;
  /** The actor performing the sync */
  actorId: string;
  /** Type of actor (user or agent) */
  actorType: 'user' | 'agent';
}

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
    const branch = await getBranch(branchId);
    const sourceBranchId = branch?.sourceBranchId;
    if (sourceBranchId === undefined) {
      return null;
    }
    const cowVersion = await getLatestPublishedDocumentVersion(document.id, sourceBranchId);
    if (cowVersion === null) {
      return null;
    }
    const cowSnapshot = cowVersion.snapshot
      ?? await reconstructVersionSnapshot(document.id, sourceBranchId, cowVersion.versionNumber);
    return { snapshot: cowSnapshot ?? {} };
  }

  const snapshot = version.snapshot
    ?? await reconstructVersionSnapshot(document.id, branchId, version.versionNumber);
  return { snapshot: snapshot ?? {} };
}

// =============================================================================
// Phase 5.2: Consolidated Sync (single query per sync)
// =============================================================================

/**
 * Database row format for document versions (used by consolidated query).
 */
interface DocumentVersionRow {
  id: string;
  document_id: string;
  branch_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  source: DocumentVersionSource;
  created_by_id: string;
  created_by_type: 'user' | 'agent' | 'system';
  created_at: string;
}

/**
 * Maps a database row to a DocumentVersion domain object.
 */
function mapRowToDocumentVersion(row: DocumentVersionRow): DocumentVersion {
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

/**
 * Consolidated single-query sync from a Durable Object to PostgreSQL (Phase 5.2).
 *
 * Replaces the previous 2-3 serial query flow:
 *   1. getDocument(documentId) — no longer needed (DO already validated)
 *   2. getLatestDocumentVersion() — folded into CTE
 *   3. createDocumentVersion() — combined INSERT
 *
 * Uses a CTE to atomically check the latest snapshot for dedup and insert
 * a new version if the snapshot has changed. Returns null if the snapshot
 * is unchanged (dedup).
 *
 * @param params - Consolidated sync parameters (no siteId needed)
 * @returns The created document version, or null if deduplicated
 * @throws SyncError if required fields are missing
 */
export async function syncCrdtToPostgresConsolidated(
  params: ConsolidatedSyncParams,
): Promise<DocumentVersion | null> {
  // Validate required fields
  if (!params.documentId || params.documentId.trim() === '') {
    throw new SyncError('Document ID is required');
  }
  if (!params.branchId || params.branchId.trim() === '') {
    throw new SyncError('Branch ID is required');
  }
  if (!params.actorId || params.actorId.trim() === '') {
    throw new SyncError('Actor ID is required');
  }

  const snapshot = enforceUniqueSlotIds(params.documentId, params.snapshot);

  const result = await query<DocumentVersionRow>(
    `WITH latest AS (
      SELECT snapshot FROM app.document_versions
      WHERE document_id = $1 AND branch_id = $2
      ORDER BY version_number DESC LIMIT 1
    )
    INSERT INTO app.document_versions (
      document_id, branch_id, version_number, snapshot,
      source, created_by_id, created_by_type
    )
    SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1,
      $3, 'realtime', $4, $5
    FROM app.document_versions
    WHERE document_id = $1 AND branch_id = $2
      AND NOT EXISTS (
        SELECT 1 FROM latest WHERE latest.snapshot = $3
      )
    RETURNING *`,
    [
      params.documentId,
      params.branchId,
      snapshot,
      params.actorId,
      params.actorType,
    ],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return mapRowToDocumentVersion(row);
}
