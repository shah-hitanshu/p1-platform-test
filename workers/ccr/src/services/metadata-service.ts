/**
 * Phase 6.2: Metadata Service
 *
 * Manages branch structure state and document metadata with JSON Schema validation.
 * Supports three enforcement modes: strict, warn, none.
 *
 * Based on collaborative-state-system-architecture-v2.2.md
 */

import Ajv from 'ajv';
import { and, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { branchDocumentMetadata, branchStructureState, documents } from '../db/schema';
import { db } from '../db/scope';
import { BranchStructureStateNotFoundError, DocumentMetadataNotFoundError, SchemaValidationError } from './errors';
import type { SchemaEnforcementMode } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Branch structure state returned from service.
 */
export interface BranchStructureState {
  branchId: string;
  structureId: string;
  structureTree: unknown[];
  metadataSchema: Record<string, unknown>;
  schemaEnforcement: SchemaEnforcementMode;
  hasChangesSinceCheckpoint: boolean | null;
  lastModifiedAt?: Date;
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
  conformsToSchema: boolean | null;
  validationErrors: ValidationError[];
  lastModifiedAt?: Date;
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
  row: typeof branchStructureState.$inferSelect,
): BranchStructureState {
  return {
    branchId: row.branchId,
    structureId: row.structureId,
    structureTree: row.structureTree as unknown[],
    metadataSchema: row.metadataSchema as Record<string, unknown>,
    schemaEnforcement: row.schemaEnforcement as SchemaEnforcementMode,
    hasChangesSinceCheckpoint: row.hasChangesSinceCheckpoint,
    lastModifiedAt: row.lastModifiedAt ?? undefined,
    lastModifiedBy: row.lastModifiedBy ?? undefined,
  };
}

function mapDocumentMetadataRow(
  row: typeof branchDocumentMetadata.$inferSelect,
): DocumentMetadata {
  return {
    branchId: row.branchId,
    structureId: row.structureId,
    documentId: row.documentId,
    metadata: row.metadata as Record<string, unknown>,
    conformsToSchema: row.conformsToSchema,
    validationErrors: row.validationErrors as ValidationError[],
    lastModifiedAt: row.lastModifiedAt ?? undefined,
    lastModifiedBy: row.lastModifiedBy ?? undefined,
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
  const [row] = await db()
    .select()
    .from(branchStructureState)
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    );

  if (!row) {
    return null;
  }
  return mapBranchStructureStateRow(row);
}

/**
 * Update branch structure state.
 */
export async function updateBranchStructureState(
  branchId: string,
  structureId: string,
  params: UpdateBranchStructureStateParams,
): Promise<BranchStructureState> {
  const changes: PgUpdateSetSource<typeof branchStructureState> = {
    hasChangesSinceCheckpoint: true,
    lastModifiedAt: sql`NOW()`,
  };

  if (params.structureTree !== undefined) {
    changes.structureTree = params.structureTree;
  }

  if (params.metadataSchema !== undefined) {
    changes.metadataSchema = params.metadataSchema;
  }

  if (params.schemaEnforcement !== undefined) {
    changes.schemaEnforcement = params.schemaEnforcement;
  }

  if (params.modifiedById !== undefined) {
    changes.lastModifiedBy = params.modifiedById;
  }

  const [updatedRow] = await db()
    .update(branchStructureState)
    .set(changes)
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    )
    .returning();

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
  const deletedRows = await db()
    .delete(branchStructureState)
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    )
    .returning({
      branchId: branchStructureState.branchId,
      structureId: branchStructureState.structureId,
    });

  if (deletedRows.length === 0) {
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
  const [docMetaRow] = await db()
    .select()
    .from(branchDocumentMetadata)
    .where(
      and(
        eq(branchDocumentMetadata.branchId, branchId),
        eq(branchDocumentMetadata.structureId, structureId),
        eq(branchDocumentMetadata.documentId, documentId),
      ),
    );

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
  const [stateRow] = await db()
    .select({
      metadataSchema: branchStructureState.metadataSchema,
      schemaEnforcement: branchStructureState.schemaEnforcement,
    })
    .from(branchStructureState)
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    );

  // Default to warn mode if state doesn't exist
  const schema = stateRow
    ? (stateRow.metadataSchema as Record<string, unknown>)
    : DEFAULT_METADATA_SCHEMA;
  const enforcement = stateRow
    ? (stateRow.schemaEnforcement as SchemaEnforcementMode)
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
  const [metaRow] = await db()
    .insert(branchDocumentMetadata)
    .values({
      branchId,
      structureId,
      documentId,
      metadata,
      conformsToSchema,
      validationErrors,
      lastModifiedAt: sql`NOW()`,
      lastModifiedBy: modifiedById ?? null,
    })
    .onConflictDoUpdate({
      target: [
        branchDocumentMetadata.branchId,
        branchDocumentMetadata.structureId,
        branchDocumentMetadata.documentId,
      ],
      set: {
        metadata: sql`excluded.metadata`,
        conformsToSchema: sql`excluded.conforms_to_schema`,
        validationErrors: sql`excluded.validation_errors`,
        lastModifiedAt: sql`excluded.last_modified_at`,
        lastModifiedBy: sql`excluded.last_modified_by`,
      },
    })
    .returning();

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
  const deletedRows = await db()
    .delete(branchDocumentMetadata)
    .where(
      and(
        eq(branchDocumentMetadata.branchId, branchId),
        eq(branchDocumentMetadata.structureId, structureId),
        eq(branchDocumentMetadata.documentId, documentId),
      ),
    )
    .returning({
      branchId: branchDocumentMetadata.branchId,
      structureId: branchDocumentMetadata.structureId,
      documentId: branchDocumentMetadata.documentId,
    });

  if (deletedRows.length === 0) {
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

  const conditions = [
    eq(branchDocumentMetadata.branchId, branchId),
    eq(branchDocumentMetadata.structureId, structureId),
  ];

  if (conformsToSchema !== undefined) {
    conditions.push(eq(branchDocumentMetadata.conformsToSchema, conformsToSchema));
  }

  const rows = await db()
    .select()
    .from(branchDocumentMetadata)
    .where(and(...conditions))
    .orderBy(branchDocumentMetadata.documentId)
    .limit(limit)
    .offset(offset);

  return rows.map(mapDocumentMetadataRow);
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
  const [validationStateRow] = await db()
    .select({ metadataSchema: branchStructureState.metadataSchema })
    .from(branchStructureState)
    .where(
      and(
        eq(branchStructureState.branchId, branchId),
        eq(branchStructureState.structureId, structureId),
      ),
    );

  if (!validationStateRow) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }
  const schema = validationStateRow.metadataSchema as Record<string, unknown>;

  // Get all document metadata with document paths
  const docRows = await db()
    .select({
      documentId: branchDocumentMetadata.documentId,
      documentPath: documents.path,
      metadata: branchDocumentMetadata.metadata,
    })
    .from(branchDocumentMetadata)
    .innerJoin(documents, eq(documents.id, branchDocumentMetadata.documentId))
    .where(
      and(
        eq(branchDocumentMetadata.branchId, branchId),
        eq(branchDocumentMetadata.structureId, structureId),
      ),
    );

  const nonConformingDocuments: NonConformingDocument[] = [];
  let conformingCount = 0;

  for (const doc of docRows) {
    const validationResult = validateMetadata(
      doc.metadata as Record<string, unknown>,
      schema,
    );

    if (validationResult.valid) {
      conformingCount++;
      // Update validation state
      await db()
        .update(branchDocumentMetadata)
        .set({ conformsToSchema: true, validationErrors: [] })
        .where(
          and(
            eq(branchDocumentMetadata.branchId, branchId),
            eq(branchDocumentMetadata.structureId, structureId),
            eq(branchDocumentMetadata.documentId, doc.documentId),
          ),
        );
    } else {
      nonConformingDocuments.push({
        documentId: doc.documentId,
        documentPath: doc.documentPath,
        errors: validationResult.errors,
      });
      // Update validation state
      await db()
        .update(branchDocumentMetadata)
        .set({ conformsToSchema: false, validationErrors: validationResult.errors })
        .where(
          and(
            eq(branchDocumentMetadata.branchId, branchId),
            eq(branchDocumentMetadata.structureId, structureId),
            eq(branchDocumentMetadata.documentId, doc.documentId),
          ),
        );
    }
  }

  return {
    structureId,
    totalDocuments: docRows.length,
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
  const [summaryRow] = await db()
    .select({
      totalDocuments: sql<number>`COUNT(*)`.mapWith(Number),
      conformingDocuments: sql<number>`
        COUNT(*) FILTER (WHERE ${branchDocumentMetadata.conformsToSchema} = TRUE)
      `.mapWith(Number),
    })
    .from(branchDocumentMetadata)
    .where(
      and(
        eq(branchDocumentMetadata.branchId, branchId),
        eq(branchDocumentMetadata.structureId, structureId),
      ),
    );

  if (!summaryRow) {
    throw new BranchStructureStateNotFoundError(branchId, structureId);
  }

  return {
    totalDocuments: summaryRow.totalDocuments,
    conformingDocuments: summaryRow.conformingDocuments,
    nonConformingCount: summaryRow.totalDocuments - summaryRow.conformingDocuments,
  };
}
