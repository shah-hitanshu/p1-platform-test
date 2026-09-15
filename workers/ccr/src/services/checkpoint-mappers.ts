/**
 * Checkpoint Service - Data Mappers and Utility Functions
 *
 * Functions for mapping database rows to domain objects
 * and shared query utilities.
 */

import type { Checkpoint, CheckpointStatus, CheckpointTrigger, CheckpointType } from '../types';
import { driverErrorCode } from '../db/driver-error';
import { toIsoTimestamp } from '../db/helpers';
import { checkpoints, checkpointStructures, documentVersions, documents } from '../db/schema';
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
    createdAt: toIsoTimestamp(row.created_at),
    // Enhanced checkpoint fields (Agent Politeness)
    description: row.description ?? undefined,
    trigger: row.trigger ?? undefined,
    requestedById: row.requested_by_id ?? undefined,
    operationType: row.operation_type ?? undefined,
    affectedRegions: row.affected_regions ?? undefined,
    status: row.status ?? undefined,
    rolledBackById: row.rolled_back_by_id ?? undefined,
    rolledBackAt: row.rolled_back_at == null ? undefined : toIsoTimestamp(row.rolled_back_at),
  };
}

/** Columns selected by the Drizzle-backed checkpoint reads, in the schema's property names. */
export const checkpointColumns = {
  id: checkpoints.id,
  branchId: checkpoints.branchId,
  name: checkpoints.name,
  message: checkpoints.message,
  checkpointType: checkpoints.checkpointType,
  parentCheckpointId: checkpoints.parentCheckpointId,
  isFullSnapshot: checkpoints.isFullSnapshot,
  createdById: checkpoints.createdById,
  createdByType: checkpoints.createdByType,
  createdAt: checkpoints.createdAt,
  description: checkpoints.description,
  trigger: checkpoints.trigger,
  requestedById: checkpoints.requestedById,
  operationType: checkpoints.operationType,
  affectedRegions: checkpoints.affectedRegions,
  status: checkpoints.status,
  rolledBackById: checkpoints.rolledBackById,
  rolledBackAt: checkpoints.rolledBackAt,
};

interface DrizzleCheckpointRow {
  id: string;
  branchId: string;
  name: string | null;
  message: string | null;
  checkpointType: string;
  parentCheckpointId: string | null;
  isFullSnapshot: boolean;
  createdById: string;
  createdByType: string;
  createdAt: Date | null;
  description: string | null;
  trigger: string | null;
  requestedById: string | null;
  operationType: string | null;
  affectedRegions: unknown;
  status: string | null;
  rolledBackById: string | null;
  rolledBackAt: Date | null;
}

/** Maps a row selected through {@link checkpointColumns} to a Checkpoint domain object. */
export function mapDrizzleRowToCheckpoint(row: DrizzleCheckpointRow): Checkpoint {
  return {
    id: row.id,
    branchId: row.branchId,
    name: row.name ?? undefined,
    message: row.message ?? undefined,
    checkpointType: row.checkpointType as CheckpointType,
    parentCheckpointId: row.parentCheckpointId ?? undefined,
    isFullSnapshot: row.isFullSnapshot,
    createdById: row.createdById,
    createdByType: row.createdByType as Checkpoint['createdByType'],
    createdAt: toIsoTimestamp(row.createdAt),
    description: row.description ?? undefined,
    trigger: (row.trigger ?? undefined) as CheckpointTrigger | undefined,
    requestedById: row.requestedById ?? undefined,
    operationType: row.operationType ?? undefined,
    affectedRegions: (row.affectedRegions as string[] | null) ?? undefined,
    status: (row.status ?? undefined) as CheckpointStatus | undefined,
    rolledBackById: row.rolledBackById ?? undefined,
    rolledBackAt: row.rolledBackAt === null ? undefined : toIsoTimestamp(row.rolledBackAt),
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
    createdAt: toIsoTimestamp(row.created_at),
    documentPath: row.document_path,
  };
}

/** Columns the checkpoint document reads select, in the schema's property names. */
export const checkpointDocumentVersionColumns = {
  id: documentVersions.id,
  documentId: documentVersions.documentId,
  branchId: documentVersions.branchId,
  versionNumber: documentVersions.versionNumber,
  snapshot: documentVersions.snapshot,
  source: documentVersions.source,
  createdById: documentVersions.createdById,
  createdByType: documentVersions.createdByType,
  createdAt: documentVersions.createdAt,
  documentPath: documents.path,
};

interface DrizzleVersionWithDocumentRow {
  id: string;
  documentId: string;
  branchId: string;
  versionNumber: number;
  snapshot: unknown;
  source: string;
  createdById: string;
  createdByType: string;
  createdAt: Date | null;
  documentPath: string;
}

/**
 * Maps a row selected through {@link checkpointDocumentVersionColumns} to a
 * CheckpointDocumentVersion domain object.
 */
export function mapDrizzleRowToCheckpointDocumentVersion(
  row: DrizzleVersionWithDocumentRow,
): CheckpointDocumentVersion {
  return {
    id: row.id,
    versionId: row.id,
    documentId: row.documentId,
    branchId: row.branchId,
    versionNumber: row.versionNumber,
    snapshot: row.snapshot as Record<string, unknown>,
    source: row.source as CheckpointDocumentVersion['source'],
    createdById: row.createdById,
    createdByType: row.createdByType as CheckpointDocumentVersion['createdByType'],
    createdAt: toIsoTimestamp(row.createdAt),
    documentPath: row.documentPath,
  };
}

/**
 * Maps a checkpoint structure row to CheckpointStructure domain object.
 */
export const checkpointStructureColumns = {
  checkpointId: checkpointStructures.checkpointId,
  structureId: checkpointStructures.structureId,
  name: checkpointStructures.name,
  slug: checkpointStructures.slug,
  description: checkpointStructures.description,
  structureType: checkpointStructures.structureType,
  structureTree: checkpointStructures.structureTree,
  metadataSchema: checkpointStructures.metadataSchema,
  schemaEnforcement: checkpointStructures.schemaEnforcement,
};

interface DrizzleCheckpointStructureRow {
  checkpointId: string;
  structureId: string;
  name: string;
  slug: string;
  description: string | null;
  structureType: string;
  structureTree: unknown;
  metadataSchema: unknown;
  schemaEnforcement: string;
}

/**
 * Maps a row selected through {@link checkpointStructureColumns} to a
 * CheckpointStructure domain object.
 */
export function mapDrizzleRowToCheckpointStructure(
  row: DrizzleCheckpointStructureRow,
): CheckpointStructure {
  return {
    checkpointId: row.checkpointId,
    structureId: row.structureId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    structureType: row.structureType,
    structureTree: row.structureTree as Record<string, unknown>[],
    metadataSchema: row.metadataSchema as Record<string, unknown>,
    schemaEnforcement: row.schemaEnforcement,
  };
}

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
  return driverErrorCode(error) === '23503';
}
