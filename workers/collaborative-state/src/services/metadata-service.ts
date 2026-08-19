/**
 * Phase 6.2: Metadata Service
 *
 * Manages branch structure state and document metadata with JSON Schema validation.
 * Supports three enforcement modes: strict, warn, none.
 *
 * Based on collaborative-state-system-architecture-v2.2.md
 */

import Ajv from 'ajv';
import { query } from '../db';
import { BranchStructureStateNotFoundError, DocumentMetadataNotFoundError, SchemaValidationError } from './errors';
import type { SchemaEnforcementMode } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Branch structure state from database row.
 */
interface BranchStructureStateRow {
  branch_id: string;
  structure_id: string;
  structure_tree: string;
  metadata_schema: string;
  schema_enforcement: string;
  has_changes_since_checkpoint: boolean;
  last_modified_at: string | null;
  last_modified_by: string | null;
}

/**
 * Document metadata from database row.
 */
interface DocumentMetadataRow {
  branch_id: string;
  structure_id: string;
  document_id: string;
  metadata: string;
  conforms_to_schema: boolean;
  validation_errors: string;
  last_modified_at: string | null;
  last_modified_by: string | null;
}

/**
 * Branch structure state returned from service.
 */
export interface BranchStructureState {
  branchId: string;
  structureId: string;
  structureTree: unknown[];
  metadataSchema: Record<string, unknown>;
  schemaEnforcement: SchemaEnforcementMode;
  hasChangesSinceCheckpoint: boolean;
  lastModifiedAt?: string;
  lastModifiedBy?: string;
}

/**
 * Document metadata returned from service.
 */
export interface DocumentMetadata {
  branchId: string;
  structureId: string;
  documentId: string;
  metadata: Record<string, unknown>;
  conformsToSchema: boolean;
  validationErrors: ValidationError[];
  lastModifiedAt?: string;
  lastModifiedBy?: string;
}

/**
 * Single validation error.
 */
export interface ValidationError {
  field: string;
  message: string;
  currentValue?: unknown;
}

/**
 * Result of validating metadata against schema.
 */
export interface MetadataValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Parameters for creating branch structure state.
 */
export interface CreateBranchStructureStateParams {
  branchId: string;
  structureId: string;
  structureTree?: unknown[];
  metadataSchema?: Record<string, unknown>;
  schemaEnforcement?: SchemaEnforcementMode;
  modifiedById?: string;
}

/**
 * Parameters for updating branch structure state.
 */
export interface UpdateBranchStructureStateParams {
  structureTree?: unknown[];
  metadataSchema?: Record<string, unknown>;
  schemaEnforcement?: SchemaEnforcementMode;
  modifiedById?: string;
}

/**
 * Parameters for setting document metadata.
 */
export interface SetDocumentMetadataParams {
  branchId: string;
  structureId: string;
  documentId: string;
  metadata: Record<string, unknown>;
  modifiedById?: string;
}

/**
 * Parameters for listing document metadata.
 */
export interface ListDocumentMetadataOptions {
  branchId: string;
  structureId: string;
  conformsToSchema?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Non-conforming document info.
 */
export interface NonConformingDocument {
  documentId: string;
  documentPath: string;
  errors: ValidationError[];
}

/**
 * Result of validating all documents.
 */
export interface SchemaValidationResult {
  structureId: string;
  totalDocuments: number;
  conformingDocuments: number;
  nonConformingDocuments: NonConformingDocument[];
}

/**
 * Schema validation summary.
 */
export interface SchemaValidationSummary {
  totalDocuments: number;
  conformingDocuments: number;
  nonConformingCount: number;
}

// =============================================================================
// Default Schema
// =============================================================================

const DEFAULT_METADATA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 100 },
    description: { type: 'string', maxLength: 300 },
  },
  required: ['title'],
};

// =============================================================================
// JSON Schema Validator
// =============================================================================

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Validate metadata against a JSON Schema.
 */
export function validateMetadata(
  metadata: Record<string, unknown>,
  schema: Record<string, unknown>,
): MetadataValidationResult {
  const validate = ajv.compile(schema);
  const valid = validate(metadata);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors ?? []).map((err) => {
    let field = 'root';
    if (err.instancePath !== '') {
      field = err.instancePath;
    } else if (
      'missingProperty' in err.params &&
      typeof err.params.missingProperty === 'string'
    ) {
      field = err.params.missingProperty;
    }
    return {
      field,
      message: err.message ?? 'Validation error',
      currentValue: err.data,
    };
  });

  return { valid: false, errors };
}

// =============================================================================
// Row Mappers
// =============================================================================

function mapBranchStructureStateRow(
  row: BranchStructureStateRow,
): BranchStructureState {
  return {
    branchId: row.branch_id,
    structureId: row.structure_id,
    structureTree: JSON.parse(row.structure_tree) as unknown[],
    metadataSchema: JSON.parse(row.metadata_schema) as Record<string, unknown>,
    schemaEnforcement: row.schema_enforcement as SchemaEnforcementMode,
    hasChangesSinceCheckpoint: row.has_changes_since_checkpoint,
    lastModifiedAt: row.last_modified_at ?? undefined,
    lastModifiedBy: row.last_modified_by ?? undefined,
  };
}

function mapDocumentMetadataRow(row: DocumentMetadataRow): DocumentMetadata {
  return {
    branchId: row.branch_id,
    structureId: row.structure_id,
    documentId: row.document_id,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    conformsToSchema: row.conforms_to_schema,
    validationErrors: JSON.parse(row.validation_errors) as ValidationError[],
    lastModifiedAt: row.last_modified_at ?? undefined,
    lastModifiedBy: row.last_modified_by ?? undefined,
  };
}

// =============================================================================
// Branch Structure State Functions
// =============================================================================

/**
 * Get branch structure state.
 */
export async function getBranchStructureState(
  branchId: string,
  structureId: string,
): Promise<BranchStructureState | null> {
  const result = await query<BranchStructureStateRow>(
    `SELECT * FROM app.branch_structure_state
     WHERE branch_id = $1 AND structure_id = $2`,
    [branchId, structureId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return mapBranchStructureStateRow(row);
}

/**
 * Create branch structure state.
 */
export async function createBranchStructureState(
  params: CreateBranchStructureStateParams,
): Promise<BranchStructureState> {
  const {
    branchId,
    structureId,
    structureTree = [],
    metadataSchema = DEFAULT_METADATA_SCHEMA,
    schemaEnforcement = 'warn',
    modifiedById,
  } = params;

  const result = await query<BranchStructureStateRow>(
    `INSERT INTO app.branch_structure_state (
       branch_id, structure_id, structure_tree, metadata_schema,
       schema_enforcement, has_changes_since_checkpoint,
       last_modified_at, last_modified_by
     ) VALUES ($1, $2, $3, $4, $5, FALSE, NOW(), $6)
     RETURNING *`,
    [
      branchId,
      structureId,
      JSON.stringify(structureTree),
      JSON.stringify(metadataSchema),
      schemaEnforcement,
      modifiedById ?? null,
    ],
  );

  const createdRow = result.rows[0];
  if (!createdRow) {
    throw new Error('Failed to create branch structure state');
  }
  return mapBranchStructureStateRow(createdRow);
}

/**
 * Update branch structure state.
 */
export async function updateBranchStructureState(
  branchId: string,
  structureId: string,
  params: UpdateBranchStructureStateParams,
): Promise<BranchStructureState> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.structureTree !== undefined) {
    updates.push(`structure_tree = $${String(paramIndex++)}`);
    values.push(JSON.stringify(params.structureTree));
  }

  if (params.metadataSchema !== undefined) {
    updates.push(`metadata_schema = $${String(paramIndex++)}`);
    values.push(JSON.stringify(params.metadataSchema));
  }

  if (params.schemaEnforcement !== undefined) {
    updates.push(`schema_enforcement = $${String(paramIndex++)}`);
    values.push(params.schemaEnforcement);
  }

  updates.push('has_changes_since_checkpoint = TRUE');
  updates.push('last_modified_at = NOW()');

  if (params.modifiedById !== undefined) {
    updates.push(`last_modified_by = $${String(paramIndex++)}`);
    values.push(params.modifiedById);
  }

  values.push(branchId);
  values.push(structureId);

  const result = await query<BranchStructureStateRow>(
    `UPDATE app.branch_structure_state
     SET ${updates.join(', ')}
     WHERE branch_id = $${String(paramIndex++)} AND structure_id = $${String(paramIndex)}
     RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }

  const updatedRow = result.rows[0];
  if (!updatedRow) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }
  return mapBranchStructureStateRow(updatedRow);
}

/**
 * Delete branch structure state.
 */
export async function deleteBranchStructureState(
  branchId: string,
  structureId: string,
): Promise<void> {
  const result = await query<{ branch_id: string; structure_id: string }>(
    `DELETE FROM app.branch_structure_state
     WHERE branch_id = $1 AND structure_id = $2
     RETURNING branch_id, structure_id`,
    [branchId, structureId],
  );

  if (result.rows.length === 0) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }
}

// =============================================================================
// Document Metadata Functions
// =============================================================================

/**
 * Get document metadata.
 */
export async function getDocumentMetadata(
  branchId: string,
  structureId: string,
  documentId: string,
): Promise<DocumentMetadata | null> {
  const result = await query<DocumentMetadataRow>(
    `SELECT * FROM app.branch_document_metadata
     WHERE branch_id = $1 AND structure_id = $2 AND document_id = $3`,
    [branchId, structureId, documentId],
  );

  const docMetaRow = result.rows[0];
  if (!docMetaRow) {
    return null;
  }

  return mapDocumentMetadataRow(docMetaRow);
}

/**
 * Set document metadata with validation.
 */
export async function setDocumentMetadata(
  params: SetDocumentMetadataParams,
): Promise<DocumentMetadata> {
  const { branchId, structureId, documentId, metadata, modifiedById } = params;

  // Get structure state for schema and enforcement mode
  const stateResult = await query<{
    metadata_schema: string;
    schema_enforcement: string;
  }>(
    `SELECT metadata_schema, schema_enforcement
     FROM app.branch_structure_state
     WHERE branch_id = $1 AND structure_id = $2`,
    [branchId, structureId],
  );

  // Default to warn mode if state doesn't exist
  const stateRow = stateResult.rows[0];
  const schema = stateRow
    ? (JSON.parse(stateRow.metadata_schema) as Record<string, unknown>)
    : DEFAULT_METADATA_SCHEMA;
  const enforcement = stateRow
    ? (stateRow.schema_enforcement as SchemaEnforcementMode)
    : 'warn';

  // Validate metadata
  let conformsToSchema = true;
  let validationErrors: ValidationError[] = [];

  if (enforcement !== 'none') {
    const validationResult = validateMetadata(metadata, schema);
    conformsToSchema = validationResult.valid;
    validationErrors = validationResult.errors;

    // In strict mode, throw error if validation fails
    if (enforcement === 'strict' && !conformsToSchema) {
      throw new SchemaValidationError(documentId, validationErrors);
    }
  }

  // Upsert metadata
  const result = await query<DocumentMetadataRow>(
    `INSERT INTO app.branch_document_metadata (
       branch_id, structure_id, document_id, metadata,
       conforms_to_schema, validation_errors,
       last_modified_at, last_modified_by
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (branch_id, structure_id, document_id)
     DO UPDATE SET
       metadata = EXCLUDED.metadata,
       conforms_to_schema = EXCLUDED.conforms_to_schema,
       validation_errors = EXCLUDED.validation_errors,
       last_modified_at = EXCLUDED.last_modified_at,
       last_modified_by = EXCLUDED.last_modified_by
     RETURNING *`,
    [
      branchId,
      structureId,
      documentId,
      JSON.stringify(metadata),
      conformsToSchema,
      JSON.stringify(validationErrors),
      modifiedById ?? null,
    ],
  );

  const metaRow = result.rows[0];
  if (!metaRow) {
    throw new Error('Failed to set document metadata');
  }
  return mapDocumentMetadataRow(metaRow);
}

/**
 * Delete document metadata.
 */
export async function deleteDocumentMetadata(
  branchId: string,
  structureId: string,
  documentId: string,
): Promise<void> {
  const result = await query<{
    branch_id: string;
    structure_id: string;
    document_id: string;
  }>(
    `DELETE FROM app.branch_document_metadata
     WHERE branch_id = $1 AND structure_id = $2 AND document_id = $3
     RETURNING branch_id, structure_id, document_id`,
    [branchId, structureId, documentId],
  );

  if (result.rows.length === 0) {
    throw new DocumentMetadataNotFoundError(branchId, structureId, documentId);
  }
}

/**
 * List document metadata in a structure.
 */
export async function listDocumentMetadata(
  options: ListDocumentMetadataOptions,
): Promise<DocumentMetadata[]> {
  const { branchId, structureId, conformsToSchema, limit = 100, offset = 0 } = options;

  let whereClause = 'WHERE branch_id = $1 AND structure_id = $2';
  const values: unknown[] = [branchId, structureId];
  let paramIndex = 3;

  if (conformsToSchema !== undefined) {
    whereClause += ` AND conforms_to_schema = $${String(paramIndex++)}`;
    values.push(conformsToSchema);
  }

  values.push(limit);
  values.push(offset);

  const result = await query<DocumentMetadataRow>(
    `SELECT * FROM app.branch_document_metadata
     ${whereClause}
     ORDER BY document_id
     LIMIT $${String(paramIndex++)} OFFSET $${String(paramIndex)}`,
    values,
  );

  return result.rows.map(mapDocumentMetadataRow);
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate all documents in a structure against the schema.
 */
export async function validateAllDocuments(
  branchId: string,
  structureId: string,
): Promise<SchemaValidationResult> {
  // Get structure state
  const stateResult = await query<{ metadata_schema: string }>(
    `SELECT metadata_schema FROM app.branch_structure_state
     WHERE branch_id = $1 AND structure_id = $2`,
    [branchId, structureId],
  );

  if (stateResult.rows.length === 0) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }

  const validationStateRow = stateResult.rows[0];
  if (!validationStateRow) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }
  const schema = JSON.parse(validationStateRow.metadata_schema) as Record<
    string,
    unknown
  >;

  // Get all document metadata with document paths
  const docsResult = await query<{
    document_id: string;
    document_path: string;
    metadata: string;
  }>(
    `SELECT bdm.document_id, d.path as document_path, bdm.metadata
     FROM app.branch_document_metadata bdm
     JOIN app.documents d ON d.id = bdm.document_id
     WHERE bdm.branch_id = $1 AND bdm.structure_id = $2`,
    [branchId, structureId],
  );

  const nonConformingDocuments: NonConformingDocument[] = [];
  let conformingCount = 0;

  for (const doc of docsResult.rows) {
    const metadata = JSON.parse(doc.metadata) as Record<string, unknown>;
    const validationResult = validateMetadata(metadata, schema);

    if (validationResult.valid) {
      conformingCount++;
      // Update validation state
      await query(
        `UPDATE app.branch_document_metadata
         SET conforms_to_schema = TRUE, validation_errors = '[]'
         WHERE branch_id = $1 AND structure_id = $2 AND document_id = $3`,
        [branchId, structureId, doc.document_id],
      );
    } else {
      nonConformingDocuments.push({
        documentId: doc.document_id,
        documentPath: doc.document_path,
        errors: validationResult.errors,
      });
      // Update validation state
      await query(
        `UPDATE app.branch_document_metadata
         SET conforms_to_schema = FALSE, validation_errors = $4
         WHERE branch_id = $1 AND structure_id = $2 AND document_id = $3`,
        [
          branchId,
          structureId,
          doc.document_id,
          JSON.stringify(validationResult.errors),
        ],
      );
    }
  }

  return {
    structureId,
    totalDocuments: docsResult.rows.length,
    conformingDocuments: conformingCount,
    nonConformingDocuments,
  };
}

/**
 * Get schema validation summary for a structure.
 */
export async function getSchemaValidationSummary(
  branchId: string,
  structureId: string,
): Promise<SchemaValidationSummary> {
  const result = await query<{
    total_documents: string;
    conforming_documents: string;
  }>(
    `SELECT
       COUNT(*) as total_documents,
       COUNT(*) FILTER (WHERE conforms_to_schema = TRUE) as conforming_documents
     FROM app.branch_document_metadata
     WHERE branch_id = $1 AND structure_id = $2`,
    [branchId, structureId],
  );

  const summaryRow = result.rows[0];
  if (!summaryRow) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }
  const totalDocuments = parseInt(summaryRow.total_documents, 10);
  const conformingDocuments = parseInt(
    summaryRow.conforming_documents,
    10,
  );

  return {
    totalDocuments,
    conformingDocuments,
    nonConformingCount: totalDocuments - conformingDocuments,
  };
}
