/**
 * Checkpoint Service - Data Mappers and Utility Functions
 *
 * Functions for mapping database rows to domain objects
 * and shared query utilities.
 */

import type { Checkpoint } from '../types';
import type {
  CheckpointDocumentVersion,
  CheckpointRow,
  CheckpointStructure,
  CheckpointStructureRow,
  VersionWithDocumentRow,
} from './checkpoint-types';

/**
 * Maps a database row to a Checkpoint domain object.
 */
export function mapRowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name ?? undefined,
    message: row.message ?? undefined,
    checkpointType: row.checkpoint_type,
    parentCheckpointId: row.parent_checkpoint_id ?? undefined,
    isFullSnapshot: row.is_full_snapshot,
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    // Enhanced checkpoint fields (Agent Politeness)
    description: row.description ?? undefined,
    trigger: row.trigger ?? undefined,
    requestedById: row.requested_by_id ?? undefined,
    operationType: row.operation_type ?? undefined,
    affectedRegions: row.affected_regions ?? undefined,
    status: row.status ?? undefined,
    rolledBackById: row.rolled_back_by_id ?? undefined,
    rolledBackAt: row.rolled_back_at ?? undefined,
  };
}

/**
 * Maps a version with document row to CheckpointDocumentVersion.
 */
export function mapRowToCheckpointDocumentVersion(row: VersionWithDocumentRow): CheckpointDocumentVersion {
  return {
    id: row.id,
    versionId: row.id,
    documentId: row.document_id,
    branchId: row.branch_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    source: row.source as CheckpointDocumentVersion['source'],
    createdById: row.created_by_id,
    createdByType: row.created_by_type,
    createdAt: row.created_at,
    documentPath: row.document_path,
  };
}

/**
 * Maps a checkpoint structure row to CheckpointStructure domain object.
 */
export function mapRowToCheckpointStructure(row: CheckpointStructureRow): CheckpointStructure {
  return {
    checkpointId: row.checkpoint_id,
    structureId: row.structure_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    structureType: row.structure_type,
    structureTree: row.structure_tree,
    metadataSchema: row.metadata_schema,
    schemaEnforcement: row.schema_enforcement,
  };
}

/**
 * Gets the first row from a query result, throwing if not present.
 */
export function getFirstRow<T>(rows: T[]): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Expected query to return at least one row');
  }
  return first;
}

/**
 * Checks if an error is a PostgreSQL foreign key constraint violation.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === '23503'
  );
}
