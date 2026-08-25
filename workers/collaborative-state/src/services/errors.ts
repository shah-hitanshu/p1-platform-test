/**
 * Shared error hierarchy for collaborative-state services.
 *
 * Every error a service throws that should map to a specific HTTP response
 * extends `HttpError` and carries its own `status`. Route handlers no longer
 * need a per-class instanceof ladder to pick a status code — they can end
 * their catch block with a single `if (error instanceof HttpError)` check.
 *
 * A handful of error classes deliberately do NOT extend `HttpError`:
 * - `DatabaseError` wraps raw database failures and its message may contain
 *   internal details, so it must keep falling through to the generic 500
 *   response rather than being echoed back to the caller.
 * - `NoDatabaseConfiguredError` and `RequestValidationError` already have
 *   their own dedicated handling paths outside the instanceof ladder.
 */

import type { ValidationError } from './metadata-service';
import type { MergeRequestStatus, BranchStatus } from '../types';

export abstract class HttpError extends Error {
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// =============================================================================
// Not found (404)
// =============================================================================

export class SiteNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly siteId: string) {
    super(`Site with ID "${siteId}" not found.`);
  }
}

export class DocumentNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly documentId: string) {
    super(`Document with ID "${documentId}" not found.`);
  }
}

export class BranchNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly branchId: string) {
    super(`Branch with ID "${branchId}" not found.`);
  }
}

export class MergeJobNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly jobId: string) {
    super(`Merge job with ID "${jobId}" not found.`);
  }
}

/**
 * Another merge job already holds the active slot for this merge request or
 * branch pair (the partial unique indexes on app.merge_jobs) [PCC-3737].
 * Carries the active job's id so route handlers can point the caller at it —
 * which is why this is not an HttpError: its 409 body needs those details,
 * not just a message.
 */
export class ActiveMergeJobExistsError extends Error {
  constructor(public readonly activeJobId: string | null) {
    super('An active merge job already exists for this merge request or branch pair');
    this.name = 'ActiveMergeJobExistsError';
  }
}

export class SourceBranchNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly branchId: string) {
    super(`Source branch with ID "${branchId}" not found.`);
  }
}

export class TargetBranchNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly branchId: string) {
    super(`Target branch with ID "${branchId}" not found.`);
  }
}

export class OrganizationNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly organizationId: string) {
    super(`Organization "${organizationId}" not found.`);
  }
}

export class AgentNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly agentId: string) {
    super(`Agent with ID "${agentId}" not found.`);
  }
}

export class StructureNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly structureId: string) {
    super(`Structure "${structureId}" not found.`);
  }
}

export class NodeNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly nodeId: string) {
    super(`Node "${nodeId}" not found.`);
  }
}

export class MergeRequestNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly mergeRequestId: string) {
    super(`Merge request with ID "${mergeRequestId}" not found.`);
  }
}

export class CheckpointNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly checkpointId: string) {
    super(`Checkpoint with ID "${checkpointId}" not found.`);
  }
}

export class TemplateNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly templateId: string) {
    super(`Template with ID "${templateId}" not found.`);
  }
}

export class MigrationJobNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly jobId: string) {
    super(`Migration job with ID "${jobId}" not found.`);
  }
}

export class GrantNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly grantId: string) {
    super(`Grant not found: ${grantId}`);
  }
}

export class VersionNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly versionId: string) {
    super(`Document version with ID "${versionId}" not found.`);
  }
}

export class RestoreVersionNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly versionId: string) {
    super(`Version with ID "${versionId}" not found.`);
  }
}

export class CanonicalVersionNotFoundError extends HttpError {
  readonly status = 404;
  constructor(
    public readonly documentId: string,
    public readonly branchId: string,
  ) {
    super(`Document "${documentId}" has no version on branch "${branchId}".`);
  }
}

export class QueryNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly queryName: string) {
    super(`Query "${queryName}" not found.`);
  }
}

export class DatasourceNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly datasourceName: string) {
    super(`Datasource "${datasourceName}" not found.`);
  }
}

export class DocumentVersionNotFoundError extends HttpError {
  readonly status = 404;
  constructor(public readonly versionId: string) {
    super(`Document version with ID "${versionId}" not found.`);
  }
}

export class BranchStructureStateNotFoundError extends HttpError {
  readonly status = 404;
  constructor(
    public readonly branchId: string,
    public readonly structureId: string,
  ) {
    super(`Branch structure state not found for branch "${branchId}" and structure "${structureId}"`);
  }
}

export class DocumentMetadataNotFoundError extends HttpError {
  readonly status = 404;
  constructor(
    public readonly branchId: string,
    public readonly structureId: string,
    public readonly documentId: string,
  ) {
    super(
      `Document metadata not found for document "${documentId}" in branch "${branchId}" and structure "${structureId}"`,
    );
  }
}

// =============================================================================
// Conflict (409)
// =============================================================================

export class PageConflictError extends HttpError {
  readonly status = 409;
  constructor(public readonly path: string) {
    super(`A page already exists at path "${path}"`);
  }
}

export class DuplicateDocumentPathError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly path: string,
    public readonly siteId?: string,
  ) {
    super(`A document with path "${path}" already exists in this site.`);
  }
}

export class DocumentPathConflictError extends HttpError {
  readonly status = 409;
  constructor(public readonly path: string) {
    super(`Path "${path}" is occupied by another document.`);
  }
}

export class DuplicateStructureSlugError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly siteId: string,
    public readonly slug: string,
  ) {
    super(`Structure with slug "${slug}" already exists in site "${siteId}".`);
  }
}

export class DuplicateNodeSlugError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly structureId: string,
    public readonly slug: string,
  ) {
    super(`Node with slug "${slug}" already exists in structure "${structureId}".`);
  }
}

export class DuplicateAgentNameError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly organizationId: string,
    public readonly agentName: string,
  ) {
    super(`Agent "${agentName}" already exists in organization "${organizationId}".`);
  }
}

export class DuplicateAgentIdError extends HttpError {
  readonly status = 409;
  constructor(public readonly agentId: string) {
    super(`Agent with ID "${agentId}" already exists.`);
  }
}

export class DuplicateBranchNameError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly siteId: string,
    public readonly branchName: string,
  ) {
    super(`A branch named "${branchName}" already exists in site "${siteId}".`);
  }
}

export class CannotDeleteMergedRequestError extends HttpError {
  readonly status = 409;
  constructor(public readonly mergeRequestId: string) {
    super(`Cannot delete merge request "${mergeRequestId}" because it has already been merged.`);
  }
}

export class OrganizationHasSitesError extends HttpError {
  readonly status = 409;
  constructor(public readonly organizationId: string) {
    super(`Cannot delete organization "${organizationId}" because it has linked sites.`);
  }
}

export class OrganizationHasActiveSitesError extends HttpError {
  readonly status = 409;
  constructor(public readonly organizationId: string) {
    super(`Cannot archive organization "${organizationId}" because it has active sites.`);
  }
}

export class DuplicateGrantError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly branchId: string,
    public readonly actorId: string,
  ) {
    super(`Grant already exists for actor ${actorId} on branch ${branchId}`);
  }
}

export class LegacyConflictDeltaError extends HttpError {
  readonly status = 409;
  constructor(public readonly conflictId: string) {
    super(
      `Migration conflict "${conflictId}" holds a legacy action-array delta that predates the `
      + 'id-keyed engine; re-run the migration to regenerate its conflicts.',
    );
  }
}

export class ConflictAlreadyResolvedError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly conflictId: string,
    public readonly existingResolution: string,
  ) {
    super(`Migration conflict "${conflictId}" is already resolved as "${existingResolution}".`);
  }
}

export class DuplicatePantheonSiteIdError extends HttpError {
  readonly status = 409;
  constructor(public readonly pantheonSiteId: string) {
    super(`A site with Pantheon site ID "${pantheonSiteId}" already exists.`);
  }
}

export class TranslationAlreadyExistsError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly canonicalDocumentId: string,
    public readonly locale: string,
  ) {
    super(`A "${locale}" translation of document "${canonicalDocumentId}" already exists.`);
  }
}

export class DatasourceInUseError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly datasourceName: string,
    public readonly referencingQueries: string[],
  ) {
    super(`Cannot delete datasource "${datasourceName}": referenced by queries: ${referencingQueries.join(', ')}`);
  }
}

export class MergeConflictsError extends HttpError {
  readonly status = 409;
  constructor(
    public readonly mergeRequestId: string,
    public readonly conflictCount: number,
  ) {
    super(`Merge request "${mergeRequestId}" has ${String(conflictCount)} conflict(s) that must be resolved.`);
  }
}

// =============================================================================
// Validation / bad request (400)
// =============================================================================

export class InvalidSlugError extends HttpError {
  readonly status = 400;
}

export class InvalidDocumentPathError extends HttpError {
  readonly status = 400;
}

export class InvalidAgentParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidMergeRequestParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidBranchParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidCheckpointParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidOrganizationParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidDocumentVersionParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidSiteParamsError extends HttpError {
  readonly status = 400;
}

export class InvalidSettingsError extends HttpError {
  readonly status = 400;
}

export class InvalidLocaleError extends HttpError {
  readonly status = 400;
  constructor(public readonly locale: string) {
    super(`"${locale}" is not a valid locale.`);
  }
}

export class InvalidBodyError extends HttpError {
  readonly status = 400;
  constructor() {
    super('Request body must be a JSON object');
  }
}

export class InvalidVersionRangeError extends HttpError {
  readonly status = 400;
  constructor(fromVersion: number, toVersion: number) {
    super(`Invalid version range: from=${String(fromVersion)}, to=${String(toVersion)} (from must be < to)`);
  }
}

export class UnsupportedStrategyError extends HttpError {
  readonly status = 400;
  constructor(public readonly strategy: string) {
    super(`Conflict resolution strategy "${strategy}" is not supported by this service.`);
  }
}

export class ManualResolutionError extends HttpError {
  readonly status = 400;
  constructor() {
    super('Manual resolution strategy requires a resolvedSnapshot.');
  }
}

export class CircularReferenceError extends HttpError {
  readonly status = 400;
  constructor(
    public readonly nodeId: string,
    public readonly targetParentId: string,
  ) {
    super(`Moving node "${nodeId}" to parent "${targetParentId}" would create a circular reference.`);
  }
}

export class InvalidMergeRequestStatusTransitionError extends HttpError {
  readonly status = 400;
  constructor(
    public readonly fromStatus: MergeRequestStatus,
    public readonly toStatus: MergeRequestStatus,
  ) {
    super(`Cannot transition merge request from "${fromStatus}" to "${toStatus}".`);
  }
}

export class TargetBranchNotMainError extends HttpError {
  readonly status = 400;
  constructor(public readonly targetBranchId: string) {
    super(`Target branch "${targetBranchId}" is not the main branch. Merge requests can only target the main branch.`);
  }
}

export class MainBranchProtectionError extends HttpError {
  readonly status = 400;
  constructor(public readonly operation: string) {
    super(`Cannot ${operation} the main branch.`);
  }
}

export class InvalidBranchStatusTransitionError extends HttpError {
  readonly status = 400;
  constructor(
    public readonly fromStatus: BranchStatus,
    public readonly toStatus: BranchStatus,
  ) {
    super(`Invalid status transition from "${fromStatus}" to "${toStatus}".`);
  }
}

export class MainBranchOnlyError extends HttpError {
  readonly status = 400;
  constructor(public readonly sourceBranchId: string) {
    super(`Branches can only be created from the main branch. Source branch "${sourceBranchId}" is not main.`);
  }
}

export class NoMergeBaseError extends HttpError {
  readonly status = 422;
  constructor(
    public readonly sourceBranchId: string,
    public readonly targetBranchId: string,
  ) {
    super(`No common ancestor found between source branch "${sourceBranchId}" and target branch "${targetBranchId}".`);
  }
}

export class SelfNestingMoveError extends HttpError {
  readonly status = 422;
  constructor(oldPath: string, newPath: string) {
    super(`Cannot move '${oldPath}' into its own subtree at '${newPath}'`);
  }
}

export class ImmovableDocumentError extends HttpError {
  readonly status = 422;
  constructor(path: string) {
    super(`Document at '${path}' cannot be moved`);
  }
}

export class MergeNotAllowedError extends HttpError {
  readonly status = 400;
  constructor(
    public readonly mergeRequestId: string,
    public readonly currentStatus: string,
    message: string,
  ) {
    super(`Merge not allowed for request "${mergeRequestId}": ${message}`);
  }
}

export class AuthorityOverrideLimitError extends HttpError {
  readonly status = 400;
  constructor(
    public readonly sourceDocumentId: string,
    limit: number,
  ) {
    super(`A translation holds at most ${String(limit)} authority overrides.`);
  }
}

export class SchemaValidationError extends HttpError {
  readonly status = 400;
  constructor(
    public readonly documentId: string,
    public readonly validationErrors: ValidationError[],
  ) {
    super(`Metadata for document "${documentId}" does not conform to schema: ${validationErrors.map((e) => e.message).join(', ')}`);
  }
}

// =============================================================================
// Rate limited (429)
// =============================================================================

export class MaxPresencesExceededError extends HttpError {
  readonly status = 429;
  constructor(maxPresences: number) {
    super(`Maximum presence limit (${String(maxPresences)}) exceeded`);
  }
}

// =============================================================================
// Internal (500) — message is safe to expose, unlike DatabaseError below
// =============================================================================

export class SyncError extends HttpError {
  readonly status = 500;
}

export class MergeExecutionError extends HttpError {
  readonly status = 500;
  constructor(
    public readonly mergeRequestId: string,
    reason: string,
  ) {
    super(`Merge execution failed for request "${mergeRequestId}": ${reason}`);
  }
}

export class VersionReconstructionError extends HttpError {
  readonly status = 500;
  constructor(
    public readonly documentId: string,
    public readonly branchId: string,
    public readonly requestedVersion: number,
    public readonly brokenVersion: number,
    reason = 'holds neither a snapshot nor a patch',
  ) {
    super(
      `Cannot reconstruct version ${String(requestedVersion)} of document `
      + `"${documentId}" on branch "${branchId}": version ${String(brokenVersion)} `
      + `${reason}.`,
    );
  }
}

// =============================================================================
// Not part of the HttpError hierarchy
// =============================================================================

/**
 * Wraps raw database errors. Deliberately does NOT extend HttpError: its
 * message may contain internal details (raw driver error text) and must
 * keep falling through to the generic 500 response rather than being
 * echoed back to the caller.
 */
export class DatabaseError extends Error {
  public readonly name = 'DatabaseError';

  constructor(message: string, public readonly operation: string) {
    super(message);
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}
