/**
 * Collaborative Content Repository - Structure, Node, and Operations Types
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
  createdAt: Date | null;
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
  /**
   * Baseline gate verdict for this connection. Absent on sockets that hibernated
   * before the gate shipped; absent is treated as 'open' so a deploy never
   * freezes a live editing session.
   */
  baselineGate?: 'open' | 'closed';
  /** Set once the first dropped frame has been logged, to bound the log volume. */
  baselineDropLogged?: boolean;
  /**
   * Whether this principal may write to the document. Resolved once at connect,
   * the way every HTTP route resolves per request. Absent on sockets that
   * hibernated before this shipped; absent is treated as permitted.
   * ponytail: per-connection grant. A socket held open after a revocation keeps
   * writing until it reconnects; closing it needs a grant-change signal the DO
   * does not have yet.
   */
  canEdit?: boolean;
  /** Set once the first refused write has been logged, to bound the log volume. */
  writeRefusalLogged?: boolean;
}

/**
 * Returns true when the connection should be treated as gate-open.
 * Absent `baselineGate` (pre-deploy hibernated sockets) is treated as open
 * so a routine deploy never freezes a live editing session.
 */
export function isGateOpen(meta: Pick<ConnectionMeta, 'baselineGate'>): boolean {
  return meta.baselineGate !== 'closed';
}
