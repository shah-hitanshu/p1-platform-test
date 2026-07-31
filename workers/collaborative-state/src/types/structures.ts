/**
 * Collaborative State System - Structure, Node, and Operations Types
 *
 * Hierarchical structures, schema validation, edit operations,
 * and connection metadata.
 */

import type {
  AuthProvider,
  EditOperationType,
  NodeType,
  SchemaEnforcementMode,
  StructureType,
} from './enums';

// =============================================================================
// Structure Types
// =============================================================================

/**
 * Hierarchical organizational container within a site.
 */
export interface SiteStructure {
  id: string;
  siteId: string;
  name: string;
  slug: string;
  description?: string;
  structureType: StructureType;
  createdAt: string;
}

/**
 * Entry in a site structure hierarchy.
 */
export interface StructureNode {
  id: string;
  structureId: string;
  parentNodeId?: string;
  position: number;
  name: string;
  slug: string;
  nodeType: NodeType;
  documentId?: string; // For document nodes
  externalUrl?: string; // For external nodes
  createdAt: string;
}

/**
 * Tracks structure state per branch.
 */
export interface BranchStructureState {
  id: string;
  branchId: string;
  structureId: string;
  nodesSnapshot: Record<string, unknown>[];
  metadataSchema?: Record<string, unknown>;
  schemaEnforcement: SchemaEnforcementMode;
  updatedAt: string;
}

/**
 * Stores metadata per document per branch.
 */
export interface BranchDocumentMetadata {
  id: string;
  branchId: string;
  documentId: string;
  structureId: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

/**
 * Single field validation error.
 */
export interface SchemaValidationError {
  field: string;
  message: string;
  currentValue?: unknown;
}

/**
 * Document that doesn't conform to schema.
 */
export interface NonConformingDocument {
  documentId: string;
  documentPath: string;
  errors: SchemaValidationError[];
}

/**
 * Result of validating documents against a structure's metadata schema.
 */
export interface SchemaValidationResult {
  structureId: string;
  totalDocuments: number;
  conformingDocuments: number;
  nonConformingDocuments: NonConformingDocument[];
}

// =============================================================================
// Operations Types
// =============================================================================

/**
 * Represents a single edit operation on document content.
 */
export interface EditOperation {
  type: EditOperationType;
  path: string;
  value?: unknown;
  content?: unknown;
  index?: number;
  fromIndex?: number;
  toIndex?: number;
}

/**
 * Metadata about a WebSocket connection to a document session.
 * Auth Phase 4: Extended with authProvider, email, and verified fields
 * to track authenticated identity context.
 */
export interface ConnectionMeta {
  actorId: string;
  actorType: 'user' | 'agent';
  /** app.users.id resolved at the auth boundary; persistence attributes to it. */
  dbUserId?: string;
  authProvider?: AuthProvider;
  email?: string;
  /** Display name for presence */
  name?: string;
  /** Profile picture URL for presence */
  avatar?: string;
  verified: boolean;
}
