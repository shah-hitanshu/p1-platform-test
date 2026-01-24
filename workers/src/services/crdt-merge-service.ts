/**
 * Phase 5.2c: CRDT Merge Service
 *
 * Resolves document conflicts using Yjs CRDT merge.
 * Merges CRDT states from both branches to produce a combined result.
 * Based on collaborative-state-system-architecture-v2.2.md
 *
 * @see collaborative-state-system-architecture-v2.2.md Section "Merge Operations"
 */

import * as Y from 'yjs';
import type { ConflictResolutionResult } from './conflict-resolution-service';
import {
  getDocumentVersion,
  createDocumentVersion,
} from './document-version-service';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for merging CRDT states.
 */
export interface MergeCrdtStatesParams {
  sourceState: string; // Base64 encoded
  targetState: string; // Base64 encoded
  baseState?: string; // Base64 encoded, optional
}

/**
 * Result of CRDT state merge.
 */
export interface MergeCrdtStatesResult {
  success: boolean;
  mergedState?: string; // Base64 encoded
  mergedSnapshot?: Record<string, unknown>;
  error?: string;
}

/**
 * Parameters for resolving a conflict with CRDT merge.
 */
export interface ResolveWithCrdtMergeParams {
  documentId: string;
  sourceBranchId: string;
  targetBranchId: string;
  sourceVersionId: string;
  targetVersionId: string;
  baseVersionId?: string;
  resolvedById: string;
  resolvedByType: 'user' | 'agent';
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when CRDT state is invalid or cannot be decoded.
 */
export class InvalidCrdtStateError extends Error {
  public readonly name = 'InvalidCrdtStateError';

  constructor(
    public readonly source: 'source' | 'target' | 'base',
    public readonly reason: string,
  ) {
    super(`Invalid CRDT state in ${source} version: ${reason}`);
    Object.setPrototypeOf(this, InvalidCrdtStateError.prototype);
  }
}

/**
 * Error thrown when a version is missing required CRDT state.
 */
export class MissingCrdtStateError extends Error {
  public readonly name = 'MissingCrdtStateError';

  constructor(public readonly versionId: string) {
    super(`Document version "${versionId}" is missing CRDT state required for merge.`);
    Object.setPrototypeOf(this, MissingCrdtStateError.prototype);
  }
}

// =============================================================================
// Yjs Utility Functions
// =============================================================================

/**
 * Decode a base64 string to a Uint8Array for Yjs.
 */
function decodeBase64ToUint8Array(base64: string): Uint8Array {
  try {
    const buffer = Buffer.from(base64, 'base64');
    return new Uint8Array(buffer);
  } catch {
    throw new Error('Invalid base64 encoding');
  }
}

/**
 * Encode a Uint8Array to base64 string.
 */
function encodeUint8ArrayToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Convert a Yjs value to a plain JavaScript value.
 */
function yValueToJs(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const obj: Record<string, unknown> = {};
    value.forEach((v, k) => {
      obj[k] = yValueToJs(v);
    });
    return obj;
  }

  if (value instanceof Y.Array) {
    return value.toArray().map(yValueToJs);
  }

  if (value instanceof Y.Text) {
    return value.toJSON();
  }

  return value;
}

/**
 * Extract a plain JavaScript snapshot from a Yjs document.
 * Reads from the 'root' map which is the convention for document content.
 */
export function extractSnapshotFromYDoc(doc: Y.Doc): Record<string, unknown> {
  const root = doc.getMap('root');
  const snapshot: Record<string, unknown> = {};

  root.forEach((value, key) => {
    snapshot[key] = yValueToJs(value);
  });

  return snapshot;
}

// =============================================================================
// CRDT Merge Functions
// =============================================================================

/**
 * Merge two CRDT states using Yjs.
 *
 * Yjs handles merging automatically - we just need to apply both states
 * to a single document and the CRDT algorithm will resolve conflicts.
 */
export function mergeCrdtStates(
  params: MergeCrdtStatesParams,
): MergeCrdtStatesResult {
  const { sourceState, targetState, baseState } = params;

  // Decode states - throw on invalid input
  let sourceUpdate: Uint8Array;
  let targetUpdate: Uint8Array;

  try {
    sourceUpdate = decodeBase64ToUint8Array(sourceState);
  } catch {
    throw new InvalidCrdtStateError('source', 'Invalid base64 encoding');
  }

  try {
    targetUpdate = decodeBase64ToUint8Array(targetState);
  } catch {
    throw new InvalidCrdtStateError('target', 'Invalid base64 encoding');
  }

  // Create a new document for the merge
  const mergedDoc = new Y.Doc();

  // If we have a base state, start from that
  if (baseState !== undefined && baseState !== '') {
    try {
      const baseUpdate = decodeBase64ToUint8Array(baseState);
      Y.applyUpdate(mergedDoc, baseUpdate);
    } catch {
      // Base state is optional, continue without it
    }
  }

  // Apply source update - catch Yjs errors
  try {
    Y.applyUpdate(mergedDoc, sourceUpdate);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invalid CRDT data';
    throw new InvalidCrdtStateError('source', reason);
  }

  // Apply target update - catch Yjs errors
  try {
    Y.applyUpdate(mergedDoc, targetUpdate);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invalid CRDT data';
    throw new InvalidCrdtStateError('target', reason);
  }

  // Extract the merged state and snapshot
  const mergedStateUpdate = Y.encodeStateAsUpdate(mergedDoc);
  const mergedState = encodeUint8ArrayToBase64(mergedStateUpdate);
  const mergedSnapshot = extractSnapshotFromYDoc(mergedDoc);

  return {
    success: true,
    mergedState,
    mergedSnapshot,
  };
}

/**
 * Resolve a document conflict using CRDT merge.
 *
 * 1. Fetch source and target versions
 * 2. Validate both have CRDT states
 * 3. Merge the CRDT states
 * 4. Create new version on target branch with merged content
 */
export async function resolveWithCrdtMerge(
  params: ResolveWithCrdtMergeParams,
): Promise<ConflictResolutionResult> {
  const {
    documentId,
    targetBranchId,
    sourceVersionId,
    targetVersionId,
    resolvedById,
    resolvedByType,
  } = params;

  // Fetch source version
  const sourceVersion = await getDocumentVersion(sourceVersionId);
  if (sourceVersion === null) {
    throw new MissingCrdtStateError(sourceVersionId);
  }

  if (sourceVersion.crdtState === undefined || sourceVersion.crdtState === '') {
    throw new MissingCrdtStateError(sourceVersionId);
  }

  // Fetch target version
  const targetVersion = await getDocumentVersion(targetVersionId);
  if (targetVersion === null) {
    throw new MissingCrdtStateError(targetVersionId);
  }

  if (targetVersion.crdtState === undefined || targetVersion.crdtState === '') {
    throw new MissingCrdtStateError(targetVersionId);
  }

  // Merge CRDT states
  const mergeResult = mergeCrdtStates({
    sourceState: sourceVersion.crdtState,
    targetState: targetVersion.crdtState,
  });

  if (!mergeResult.success) {
    return {
      resolved: false,
      documentId,
      strategy: 'merge-crdt',
      resolvedById,
      resolvedByType,
      error: mergeResult.error,
    };
  }

  // Create new version with merged content
  const newVersion = await createDocumentVersion({
    documentId,
    branchId: targetBranchId,
    snapshot: mergeResult.mergedSnapshot ?? {},
    crdtState: mergeResult.mergedState,
    source: 'merge',
    createdById: resolvedById,
    createdByType: resolvedByType,
  });

  return {
    resolved: true,
    documentId,
    strategy: 'merge-crdt',
    resultVersionId: newVersion.id,
    resolvedById,
    resolvedByType,
  };
}
