/**
 * Phase 7.1.1b: Document CRUD API Routes
 *
 * REST API endpoints for document CRUD operations.
 * Includes soft-delete with archive/restore functionality.
 */

import type { AuthenticatedPrincipal } from '../types';
import {
  createDocument,
  getDocument,
  getDocumentByPath,
  updateDocumentFields,
  archiveDocument,
  restoreDocument,
  listDocuments,
  // Branch-scoped document operations
  listDocumentsOnBranch,
  createDocumentOnBranch,
  documentExistsOnBranch,
  deleteDocumentOnBranch,
  deleteDocumentWithRedirect,
  PageConflictError,
  getBranch,
  getMainBranch,
  // Document version operations
  getLatestDocumentVersion,
  getLatestDocumentVersionWithFallback,
  getDocumentVersion,
  listDocumentVersions,
  createDocumentVersion,
  reconstructVersionSnapshot,
  restoreDocumentVersion,
  SiteNotFoundError,
  DuplicateDocumentPathError,
  InvalidDocumentPathError,
  DocumentNotFoundError,
  DocumentPathConflictError,
  InvalidDocumentVersionParamsError,
  RestoreVersionNotFoundError,
  publishDocument,
  createTranslation,
  listLocaleVariants,
  InvalidLocaleError,
  CanonicalVersionNotFoundError,
  TranslationAlreadyExistsError,
  buildChangeSummary,
  getLocalizationEdgeBySource,
  getAuthorityOverrides,
  authorityOverridesToJson,
  setAuthorityOverride,
  clearAuthorityOverride,
  resolveSlotAuthorityDefaults,
} from '../services';
import type { ChangeRelationType } from '../services';
import { validateBody, validationErrorResponse } from './validation/request-validation';
import { handleAuthorityOverridesValidation } from './validation/document-api.validation';
import { isChangeRelationType } from '../services/change-summary-service';
import { AuthorityOverrideLimitError } from '../services/relations-service';
import {
  normalizePath,
  isRegistryWritePath,
  isRegistryScopedServicePrincipal,
  type DocumentVersion,
} from '../services/document-types';
import { buildDocumentSkeletonFromTemplate } from '../services/document-skeleton';
import { applyTitleToSnapshot } from '../services/document-title';
import { assertPermission, AuthorizationError, getEffectiveRole } from '../auth/authorization';
import { templateMetadata } from './template-api';
import { validatePagination } from './validation';
import { purgeContentCache } from '../cache/purge';

/** The operation a document route path names beyond the document itself. */
export type DocumentRouteAction =
  | 'restore'
  | 'publish'
  | 'translations'
  | 'upstream-diff'
  | 'authority-overrides';

/** The operation a document route path names against a version. */
export type DocumentVersionAction = 'latest' | 'by-id' | 'restore';

/**
 * Request context for document routes
 */
export interface DocumentRouteContext {
  siteId: string;
  branchId?: string;
  documentId?: string;
  documentPath?: string;
  action?: DocumentRouteAction;
  versionsPath?: boolean;
  versionAction?: DocumentVersionAction;
  versionId?: string;
  principal: AuthenticatedPrincipal;
}

/**
 * Deny-by-default allowlist for write:registry. The coarse gate
 * (isServicePrincipalAllowed) authorizes POST to the entire 'documents'
 * handler, which also covers publish, site-scoped restore, and site-scoped
 * create — none of which this scope should grant. Only branch-scoped
 * document create and branch-scoped version create are permitted here; the
 * path-prefix restriction is enforced separately by isRegistryWritePath at
 * those two call sites.
 */
function isAllowedRegistryOperation(context: DocumentRouteContext, method: string): boolean {
  if (method !== 'POST' || context.branchId === undefined || context.action !== undefined) {
    return false;
  }
  if (context.documentId === undefined) {
    return true;
  }
  return context.versionsPath === true && context.versionAction === undefined;
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  return json as T;
}

/**
 * Request body for creating a document
 */
interface CreateDocumentBody {
  path?: string;
  title?: string;
  snapshot?: Record<string, unknown>;
  templateId?: string;
  templateVersion?: number;
}

/**
 * Request body for updating a document. Each field is optional and a field left out
 * keeps its stored value; a null `locale` clears the document's language tag.
 */
interface UpdateDocumentBody {
  path?: string;
  locale?: string | null;
}

/**
 * Request body for creating a translation of a document
 */
interface CreateTranslationBody {
  locale?: string;
  path?: string;
}

/**
 * JSON response helper
 */
function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Error response helper
 */
function errorResponse(
  error: string,
  status: number,
  details?: unknown,
): Response {
  return jsonResponse({ error, details }, status);
}

/**
 * Handle POST /api/sites/{siteId}/documents - Create Document
 */
async function handleCreateDocument(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const body = await parseJsonBody<CreateDocumentBody>(request);

  // Validate required fields
  if (body.path === undefined || body.path.trim() === '') {
    return errorResponse('path is required', 400);
  }

  const document = await createDocument({
    siteId: context.siteId,
    path: body.path,
  });

  return jsonResponse(document, 201);
}

/**
 * Handle GET /api/sites/{siteId}/documents - List Documents
 */
async function handleListDocuments(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const pathPrefix = url.searchParams.get('pathPrefix');
  const archivedParam = url.searchParams.get('archived');

  // Validate pagination parameters
  const pagination = validatePagination(limitParam, offsetParam);
  if (!pagination.valid) {
    return errorResponse(pagination.error ?? 'Invalid pagination parameters', 400);
  }

  const archived = archivedParam === 'true' ? true : archivedParam === 'false' ? false : undefined;

  const documents = await listDocuments(context.siteId, {
    limit: pagination.limit,
    offset: pagination.offset,
    pathPrefix: pathPrefix ?? undefined,
    archived,
  });

  return jsonResponse({ documents });
}

/**
 * Handle GET /api/sites/{siteId}/documents/{documentId} - Get Document
 */
async function handleGetDocument(context: DocumentRouteContext): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const document = await getDocument(context.documentId);

  if (document === null) {
    return errorResponse('Document not found', 404);
  }

  return jsonResponse(document);
}

/**
 * Handle GET /api/sites/{siteId}/documents/by-path/{documentPath} - Get by Path
 */
async function handleGetDocumentByPath(context: DocumentRouteContext): Promise<Response> {
  if (context.documentPath === undefined) {
    return errorResponse('Document path is required', 400);
  }

  const document = await getDocumentByPath(context.siteId, context.documentPath);

  if (document === null) {
    return errorResponse('Document not found at path', 404);
  }

  return jsonResponse(document);
}

/**
 * Handle PATCH /api/sites/{siteId}/documents/{documentId} - Update Document Path or Locale
 */
async function handleUpdateDocument(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const body = await parseJsonBody<UpdateDocumentBody>(request);

  const fields: { path?: string; locale?: string | null } = {};

  if (body.path !== undefined) {
    if (body.path.trim() === '') {
      return errorResponse('path cannot be empty', 400);
    }
    fields.path = body.path;
  }

  if (body.locale !== undefined) {
    fields.locale = body.locale;
  }

  if (Object.keys(fields).length === 0) {
    return errorResponse('path or locale is required', 400);
  }

  const updatedDocument = await updateDocumentFields(context.documentId, fields);

  if (updatedDocument === null) {
    return errorResponse('Document not found', 404);
  }

  return jsonResponse(updatedDocument);
}

/**
 * Handle DELETE /api/sites/{siteId}/documents/{documentId} - Soft Delete (Archive)
 */
async function handleDeleteDocument(context: DocumentRouteContext): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const archived = await archiveDocument(context.documentId);

  if (!archived) {
    return errorResponse('Document not found', 404);
  }

  // Archiving hides the document from content delivery immediately, so without
  // this the edge keeps serving the taken-down page for the full TTL plus its
  // stale-while-revalidate window.
  await purgeContentCache({
    siteId: context.siteId,
    documentId: context.documentId,
  });

  return new Response(null, { status: 204 });
}

/**
 * Handle POST /api/sites/{siteId}/documents/{documentId}/restore - Restore Document
 */
async function handleRestoreDocument(context: DocumentRouteContext): Promise<Response> {
  if (context.documentId === undefined) {
    return errorResponse('Document ID is required', 400);
  }

  const document = await restoreDocument(context.documentId);

  // The archive cached a 404 at this path; restoring has to clear it.
  await purgeContentCache({
    siteId: context.siteId,
    documentId: context.documentId,
  });

  return jsonResponse(document);
}

// =============================================================================
// Branch-Scoped Document Operations
// =============================================================================

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents
 *
 * For non-main branches, includes inherited documents from main via COW fallback.
 */
async function handleListDocumentsOnBranch(
  request: Request,
  siteId: string,
  branchId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const pathPrefix = url.searchParams.get('pathPrefix');

  // For non-main branches, pass mainBranchId to enable copy-on-write fallback
  const branch = await getBranch(branchId);
  const mainBranch = branch && !branch.isMain ? await getMainBranch(siteId) : null;

  const documents = await listDocumentsOnBranch(branchId, {
    pathPrefix: pathPrefix ?? undefined,
    mainBranchId: mainBranch?.id,
  });

  return jsonResponse({ documents });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/documents
 */
async function handleCreateDocumentOnBranch(
  request: Request,
  siteId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<CreateDocumentBody>(request);

  if (body.path === undefined || body.path.trim() === '') {
    return errorResponse('path is required', 400);
  }

  // Normalize path using the canonical normalizePath which handles backslashes,
  // multiple slashes, and leading/trailing slash stripping consistently
  const normalizedPath = normalizePath(body.path);

  if (isRegistryScopedServicePrincipal(principal) && !isRegistryWritePath(normalizedPath)) {
    return errorResponse(
      'write:registry scope only permits documents under _registry/components/ or the registry index',
      403,
    );
  }

  // Prevent non-admins from creating documents at _registry/templates/* via document API
  if (normalizedPath.startsWith('_registry/templates/')) {
    const { roleName } = await getEffectiveRole(principal, siteId, branchId);
    if (roleName !== 'ADMIN') {
      return errorResponse(
        'Templates must be created via template API (admin only)',
        403,
      );
    }
  }

  // Check if template is deprecated before creating a document from it,
  // and default template_version to current version when not provided.
  let resolvedTemplateVersion = body.templateVersion;
  let snapshotForCreate: Record<string, unknown> | undefined =
    body.title === undefined
      ? body.snapshot
      : applyTitleToSnapshot(body.snapshot, body.title);
  if (body.templateId !== undefined && body.templateId !== '') {
    // Templates commonly live on main and inherit into feature branches via
    // copy-on-write fallback, so resolve the template's latest version through
    // the fallback rather than the branch-local lookup.
    const mainBranch = await getMainBranch(siteId);
    let latestTemplateVersion: DocumentVersion | null = null;
    if (mainBranch !== null) {
      const fallback = await getLatestDocumentVersionWithFallback(
        body.templateId, branchId, mainBranch.id,
      );
      const fv = fallback?.version;
      latestTemplateVersion = fv ? {
        id: fv.id,
        documentId: fv.documentId,
        branchId: fv.branchId,
        versionNumber: fv.versionNumber,
        snapshot: fv.snapshot ?? {},
        source: fv.source,
        createdById: fv.createdById,
        createdByType: fv.createdByType,
        createdAt: fv.createdAt,
      } : null;
    }
    if (latestTemplateVersion?.snapshot !== undefined) {
      if (templateMetadata(latestTemplateVersion.snapshot).deprecated === true) {
        return errorResponse('Cannot create document from deprecated template', 400);
      }
    }
    if (resolvedTemplateVersion === undefined && latestTemplateVersion) {
      resolvedTemplateVersion = latestTemplateVersion.versionNumber;
    }

    // A template-sourced document's snapshot is built from the template, not
    // supplied by the client, so the two are mutually exclusive.
    if (body.snapshot !== undefined) {
      return errorResponse('Cannot supply a snapshot when creating a document from a template', 400);
    }
    snapshotForCreate = buildDocumentSkeletonFromTemplate(latestTemplateVersion?.snapshot, {
      title: body.title,
    }) as unknown as Record<string, unknown>;
  }

  const result = await createDocumentOnBranch({
    siteId,
    branchId,
    path: body.path,
    snapshot: snapshotForCreate,
    templateId: body.templateId,
    templateVersion: resolvedTemplateVersion,
    createdById: principal.dbUserId ?? principal.id,
    createdByType: principal.type === 'service' ? 'system' : principal.type,
  });

  return jsonResponse(result, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}
 */
async function handleGetDocumentOnBranch(
  documentId: string,
  branchId: string,
  siteId: string,
  isMainBranch: boolean,
): Promise<Response> {
  // Check if document exists on this branch
  const exists = await documentExistsOnBranch(documentId, branchId);
  if (!exists) {
    // For non-main branches, check if document is inherited from main
    if (!isMainBranch) {
      const mainBranch = await getMainBranch(siteId);
      if (mainBranch !== null) {
        const fallback = await getLatestDocumentVersionWithFallback(
          documentId, branchId, mainBranch.id,
        );
        if (fallback !== null) {
          // Document exists on main — return it
          const document = await getDocument(documentId);
          if (document !== null) {
            return jsonResponse(document);
          }
        }
      }
    }
    return errorResponse('Document not found on this branch', 404);
  }

  // Get the document details
  const document = await getDocument(documentId);
  if (document === null) {
    return errorResponse('Document not found', 404);
  }

  return jsonResponse(document);
}

const MAX_REDIRECT_PATH_LENGTH = 1024;

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '');
}

interface DeleteDocumentBody {
  redirect?: {
    fromPath?: string;
    destination?: string;
    redirectType?: string;
    parenting?: boolean;
  };
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId}/documents/{documentId}
 *
 * Accepts an optional JSON body with a `redirect` field. When present, the
 * document is tombstoned and a redirect is created atomically within a single
 * database transaction. When absent, behavior is unchanged (204 with no body).
 *
 * Body presence is determined by reading the actual bytes rather than by
 * checking `request.body !== null` or trusting the Content-Type header alone:
 * on Cloudflare's runtime, non-GET/HEAD requests get a non-null body stream
 * even when zero bytes were sent, and clients commonly attach a default
 * Content-Type (e.g. `application/json` or `text/plain`) to bodyless
 * requests. An empty body is therefore always treated as absent, regardless
 * of Content-Type.
 */
async function handleDeleteDocumentOnBranch(
  request: Request,
  documentId: string,
  branchId: string,
  siteId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const rawBody = await request.text();
  let body: DeleteDocumentBody | undefined;

  if (rawBody.trim() !== '') {
    const contentType = request.headers.get('Content-Type');
    if (contentType?.includes('application/json') !== true) {
      return errorResponse('Content-Type must be application/json when sending a request body', 415);
    }
    try {
      body = JSON.parse(rawBody) as DeleteDocumentBody;
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }
  }

  if (body?.redirect === undefined) {
    await deleteDocumentOnBranch({
      documentId,
      branchId,
      deletedById: principal.dbUserId ?? principal.id,
      deletedByType: principal.type,
    });
    return new Response(null, { status: 204 });
  }

  const r = body.redirect;

  if (r.fromPath === undefined || r.fromPath === '') {
    return errorResponse('redirect.fromPath is required', 400);
  }
  if (r.fromPath.length > MAX_REDIRECT_PATH_LENGTH) {
    return errorResponse('redirect.fromPath exceeds maximum length', 400);
  }
  if (r.fromPath.trim() === '') {
    return errorResponse('redirect.fromPath is required', 400);
  }
  if (!r.fromPath.startsWith('/')) {
    return errorResponse('redirect.fromPath must start with /', 400);
  }
  const normalizedFromPath = stripTrailingSlashes(r.fromPath) || '/';
  if (normalizedFromPath === '/') {
    return errorResponse('redirect.fromPath must not be the root path', 400);
  }
  if (r.destination === undefined || r.destination.trim() === '') {
    return errorResponse('redirect.destination is required', 400);
  }
  const redirectType = r.redirectType ?? 'permanent';
  if (redirectType !== 'permanent' && redirectType !== 'temporary') {
    return errorResponse('redirect.redirectType must be permanent or temporary', 400);
  }
  const parenting = r.parenting ?? false;
  const originPath = normalizedFromPath.slice(1);

  const result = await deleteDocumentWithRedirect({
    documentId,
    branchId,
    siteId,
    deletedById: principal.dbUserId ?? principal.id,
    deletedByType: principal.type,
    redirect: {
      fromPath: originPath,
      destination: r.destination,
      redirectType: redirectType,
      parenting,
    },
  });

  return jsonResponse(result.redirect, 200);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/translations
 *
 * Clones the canonical document (documentId) into a new locale variant.
 */
async function handleCreateTranslation(
  request: Request,
  branchId: string,
  canonicalDocumentId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<CreateTranslationBody>(request);

  if (body.locale === undefined || body.locale.trim() === '') {
    return errorResponse('locale is required', 400);
  }

  const result = await createTranslation({
    canonicalDocumentId,
    branchId,
    locale: body.locale,
    path: body.path,
    createdById: principal.dbUserId ?? principal.id,
    createdByType: principal.type,
  });

  return jsonResponse(result, 201);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/translations
 *
 * Lists the canonical document (documentId) and its locale variants.
 */
async function handleListLocaleVariants(
  canonicalDocumentId: string,
  branchId: string,
): Promise<Response> {
  const result = await listLocaleVariants(canonicalDocumentId, branchId);
  return jsonResponse(result);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/upstream-diff
 *
 * Reports the classified drift of a document against its upstream edge target.
 */
async function handleUpstreamDiff(
  relationType: ChangeRelationType,
  branchId: string,
  documentId: string,
): Promise<Response> {
  const summary = await buildChangeSummary({
    sourceDocumentId: documentId,
    branchId,
    relationType,
  });

  if (summary === null) {
    return errorResponse(`No ${relationType} relation for this document`, 404);
  }

  return jsonResponse(summary);
}

/**
 * Handles the authority-override routes on a translation:
 * - GET returns the full per-prop authority map.
 * - PUT sets one (slotId, propName) override to canonical or locale.
 * - DELETE clears one (slotId, propName) override.
 *
 * The document must be a translation (the source of a localization edge);
 * otherwise the route 404s.
 */
async function handleAuthorityOverrides(
  request: Request,
  documentId: string,
  branchId: string,
): Promise<Response> {
  const edge = await getLocalizationEdgeBySource(documentId);
  if (edge === null) {
    return errorResponse('Document is not a translation', 404);
  }

  // Every response carries the resolved map, so a client that has just set or
  // cleared an override re-reads authority from the same body.
  const authorityBody = async (): Promise<Record<string, unknown>> => {
    const authorityOverrides = await getAuthorityOverrides(documentId);
    const defaults = await resolveSlotAuthorityDefaults(edge.targetDocumentId, branchId);
    return { authorityOverrides: authorityOverridesToJson(authorityOverrides), ...defaults };
  };

  const method = request.method;

  if (method === 'GET') {
    return jsonResponse(await authorityBody());
  }

  const rawBody = await parseJsonBody<unknown>(request);

  if (method === 'PUT') {
    const { slotId, propName, authority } = validateBody(
      handleAuthorityOverridesValidation.setBody,
      rawBody,
    );
    await setAuthorityOverride(documentId, slotId, propName, authority);
  } else {
    const { slotId, propName } = validateBody(
      handleAuthorityOverridesValidation.clearBody,
      rawBody,
    );
    await clearAuthorityOverride(documentId, slotId, propName);
  }

  return jsonResponse(await authorityBody());
}

// =============================================================================
// Document Version Operations
// =============================================================================

/**
 * Request body for creating a document version
 */
interface CreateVersionBody {
  snapshot?: Record<string, unknown> | null;
  puckActions?: { type: string; [key: string]: unknown }[];
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
 */
async function handleListDocumentVersions(
  documentId: string,
  branchId: string,
): Promise<Response> {
  const versions = await listDocumentVersions(documentId, branchId);
  return jsonResponse({ versions });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/latest
 */
async function handleGetLatestDocumentVersion(
  documentId: string,
  branchId: string,
  siteId: string,
  isMainBranch: boolean,
): Promise<Response> {
  // Try local version first
  const version = await getLatestDocumentVersion(documentId, branchId);
  if (version !== null) {
    return jsonResponse(version);
  }

  // For non-main branches, fall back to main's published version
  if (!isMainBranch) {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch !== null) {
      const fallback = await getLatestDocumentVersionWithFallback(
        documentId, branchId, mainBranch.id,
      );
      if (fallback !== null) {
        return jsonResponse({ ...fallback.version, inherited: fallback.inherited });
      }
    }
  }

  return errorResponse('No versions found for this document on this branch', 404);
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions/{versionId}
 */
async function handleGetDocumentVersionById(
  documentId: string,
  branchId: string,
  versionId: string,
): Promise<Response> {
  // Fetch version by ID
  const version = await getDocumentVersion(versionId);

  // Validate version exists and belongs to this document/branch
  if (version?.documentId !== documentId || version.branchId !== branchId) {
    return errorResponse('Version not found', 404);
  }

  // If snapshot is null (diff-only version), reconstruct from baseline + patches
  if (version.snapshot == null) {
    try {
      const reconstructed = await reconstructVersionSnapshot(
        documentId,
        branchId,
        version.versionNumber,
      );
      return jsonResponse({ ...version, snapshot: reconstructed });
    } catch (err) {
      console.error('reconstructVersionSnapshot failed:', err);
      return errorResponse('Failed to reconstruct version snapshot', 500);
    }
  }

  return jsonResponse(version);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/documents/{documentId}/versions
 */
async function handleCreateDocumentVersion(
  request: Request,
  documentId: string,
  branchId: string,
  siteId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const document = await getDocument(documentId);

  if (
    document !== null &&
    isRegistryScopedServicePrincipal(principal) &&
    !isRegistryWritePath(document.path)
  ) {
    return errorResponse(
      'write:registry scope only permits document versions under _registry/components/ or the registry index',
      403,
    );
  }

  // Prevent non-admins from writing versions to template documents via document API
  if (document?.path.startsWith('_registry/templates/') === true) {
    const { roleName } = await getEffectiveRole(principal, siteId, branchId);
    if (roleName !== 'ADMIN') {
      return errorResponse(
        'Template versions must be created via template API (admin only)',
        403,
      );
    }
  }

  const body = await parseJsonBody<CreateVersionBody>(request);

  // Validate snapshot is present and is an object
  if (body.snapshot === undefined) {
    return errorResponse('snapshot is required', 400);
  }

  // Validate snapshot is a non-null, non-array object
  if (typeof body.snapshot !== 'object' || body.snapshot === null || Array.isArray(body.snapshot)) {
    return errorResponse('snapshot must be a JSON object', 400);
  }

  const version = await createDocumentVersion({
    documentId,
    branchId,
    snapshot: body.snapshot,
    source: 'edit',
    createdById: principal.dbUserId ?? principal.id,
    createdByType: principal.type === 'service' ? 'system' : principal.type,
    ...(body.puckActions ? { puckActions: body.puckActions } : {}),
  });

  return jsonResponse(version, 201);
}

async function handleRestoreDocumentVersionRoute(
  documentId: string,
  branchId: string,
  versionId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  try {
    const newVersion = await restoreDocumentVersion({
      documentId,
      branchId,
      versionId,
      createdById: principal.dbUserId ?? principal.id,
      createdByType: principal.type === 'service' ? 'system' : principal.type,
    });
    return jsonResponse(newVersion, 201);
  } catch (error) {
    if (error instanceof RestoreVersionNotFoundError) {
      return errorResponse('Version not found', 404);
    }
    throw error;
  }
}

/**
 * Handle document version routes within branch scope
 */
async function handleDocumentVersionRoutes(
  request: Request,
  documentId: string,
  branchId: string,
  context: DocumentRouteContext,
  isMainBranch: boolean,
): Promise<Response> {
  const method = request.method;

  // Check if document exists on branch (local versions)
  const exists = await documentExistsOnBranch(documentId, branchId);
  if (!exists) {
    // For non-main branches, check if document is inherited from main (COW)
    if (!isMainBranch) {
      const mainBranch = await getMainBranch(context.siteId);
      if (mainBranch !== null) {
        const fallback = await getLatestDocumentVersionWithFallback(
          documentId, branchId, mainBranch.id,
        );
        if (fallback === null) {
          return errorResponse('Document not found on this branch', 404);
        }
        // Document is inherited from main — allow version routes to proceed
      } else {
        return errorResponse('Document not found on this branch', 404);
      }
    } else {
      return errorResponse('Document not found on this branch', 404);
    }
  }

  // Authorization for version routes
  if (method === 'GET') {
    await assertPermission(context.principal, context.siteId, branchId, 'canView');
  } else if (method === 'POST') {
    await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
  }

  // GET /versions/latest
  if (context.versionAction === 'latest') {
    if (method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    return await handleGetLatestDocumentVersion(documentId, branchId, context.siteId, isMainBranch);
  }

  // GET /versions/{versionId}
  if (context.versionAction === 'by-id' && context.versionId !== undefined) {
    if (method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    return await handleGetDocumentVersionById(documentId, branchId, context.versionId);
  }

  // POST /versions/{versionId}/restore
  if (context.versionAction === 'restore' && context.versionId !== undefined) {
    if (method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    return await handleRestoreDocumentVersionRoute(
      documentId, branchId, context.versionId, context.principal,
    );
  }

  // GET /versions - list versions
  // POST /versions - create version
  switch (method) {
    case 'GET':
      return await handleListDocumentVersions(documentId, branchId);
    case 'POST':
      return await handleCreateDocumentVersion(request, documentId, branchId, context.siteId, context.principal);
    default:
      return errorResponse('Method not allowed', 405);
  }
}

/**
 * Handle branch-scoped document routes
 */
async function handleBranchScopedDocumentRoutes(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const method = request.method;
  const branchId = context.branchId;

  if (branchId === undefined) {
    return errorResponse('Branch ID is required', 400);
  }

  // Validate branch exists and belongs to the correct site
  const branch = await getBranch(branchId);
  if (branch?.siteId !== context.siteId) {
    return errorResponse('Branch not found', 404);
  }

  // Handle publish action
  if (context.action === 'publish' && context.documentId !== undefined) {
    if (method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }
    await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
    const exists = await documentExistsOnBranch(context.documentId, branchId);
    if (!exists) {
      return errorResponse('Document not found on this branch', 404);
    }
    // Prevent non-admins from publishing template documents via document API
    const document = await getDocument(context.documentId);
    if (document?.path.startsWith('_registry/templates/') === true) {
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        return errorResponse(
          'Templates must be published via template API (admin only)',
          403,
        );
      }
    }
    const result = await publishDocument({
      siteId: context.siteId,
      branchId,
      documentId: context.documentId,
      createdById: context.principal.dbUserId ?? context.principal.id,
      createdByType: context.principal.type as 'user' | 'agent',
    });
    return jsonResponse(result);
  }

  // Handle translations: create a locale variant (POST) or list variants (GET)
  if (context.action === 'translations' && context.documentId !== undefined) {
    if (method !== 'POST' && method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    await assertPermission(
      context.principal,
      context.siteId,
      branchId,
      method === 'POST' ? 'canEditDocuments' : 'canView',
    );
    // The branch belongs to context.siteId, so a canonical absent from the branch
    // belongs to another tenant and is out of this caller's reach.
    const exists = await documentExistsOnBranch(context.documentId, branchId);
    if (!exists) {
      return errorResponse('Document not found on this branch', 404);
    }
    if (method === 'POST') {
      return await handleCreateTranslation(
        request,
        branchId,
        context.documentId,
        context.principal,
      );
    }
    return await handleListLocaleVariants(context.documentId, branchId);
  }

  // Handle upstream-diff: classified drift of a document against its edge target
  if (context.action === 'upstream-diff' && context.documentId !== undefined) {
    if (method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }
    await assertPermission(context.principal, context.siteId, branchId, 'canView');
    const relationTypeParam =
      new URL(request.url).searchParams.get('relationType') ?? 'localization';
    if (!isChangeRelationType(relationTypeParam)) {
      return errorResponse('relationType must be one of: template, localization', 400);
    }
    const exists = await documentExistsOnBranch(context.documentId, branchId);
    if (!exists) {
      return errorResponse('Document not found on this branch', 404);
    }
    return await handleUpstreamDiff(relationTypeParam, branchId, context.documentId);
  }

  // Handle authority-overrides: read the per-prop authority map (GET) or set/clear
  // a single (slotId, propName) override (PUT/DELETE) on a translation.
  if (context.action === 'authority-overrides' && context.documentId !== undefined) {
    if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
      return errorResponse('Method not allowed', 405);
    }
    await assertPermission(
      context.principal,
      context.siteId,
      branchId,
      method === 'GET' ? 'canView' : 'canEditDocuments',
    );
    const exists = await documentExistsOnBranch(context.documentId, branchId);
    if (!exists) {
      return errorResponse('Document not found on this branch', 404);
    }
    return await handleAuthorityOverrides(request, context.documentId, branchId);
  }

  // Handle document version routes (authorization is handled inside handleDocumentVersionRoutes)
  if (context.versionsPath === true && context.documentId !== undefined) {
    return await handleDocumentVersionRoutes(request, context.documentId, branchId, context, branch.isMain);
  }

  // Authorization for branch-scoped document routes
  if (method === 'GET') {
    await assertPermission(context.principal, context.siteId, branchId, 'canView');
  } else if (method === 'POST' || method === 'DELETE') {
    await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
  }

  // Routes with documentId
  if (context.documentId !== undefined) {
    switch (method) {
      case 'GET':
        return await handleGetDocumentOnBranch(context.documentId, branchId, context.siteId, branch.isMain);
      case 'DELETE':
        return await handleDeleteDocumentOnBranch(
          request, context.documentId, branchId, context.siteId, context.principal,
        );
      default:
        return errorResponse('Method not allowed', 405);
    }
  }

  // Collection routes
  switch (method) {
    case 'GET':
      return await handleListDocumentsOnBranch(request, context.siteId, branchId);
    case 'POST':
      return await handleCreateDocumentOnBranch(request, context.siteId, branchId, context.principal);
    default:
      return errorResponse('Method not allowed', 405);
  }
}

/**
 * Main route handler for document operations
 */
export async function handleDocumentRoutes(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    // This gate does not check whether some OTHER scope on the same token
    // independently authorizes the request (contrast branch-api.ts's
    // equivalent guard, which does via isAllowedByAnotherScope) — safe only
    // because no scope besides write:registry currently grants POST on the
    // documents handler (enforced by a canary test in
    // service-principal-scopes.spec.ts). If a future scope is ever given
    // POST+documents, that test will fail and this guard must be updated to
    // check isAllowedByAnotherScope first, mirroring branch-api.ts — a naive
    // scope addition here would wrongly 403 a combined-scope token the same
    // way branch-api.ts's guard once did for GET+branches.
    if (
      method === 'POST' &&
      isRegistryScopedServicePrincipal(context.principal) &&
      !isAllowedRegistryOperation(context, method)
    ) {
      return errorResponse(
        'write:registry scope only permits creating documents or document versions under _registry/components/',
        403,
      );
    }

    // Handle branch-scoped routes first (authorization handled inside)
    if (context.branchId !== undefined) {
      return await handleBranchScopedDocumentRoutes(request, context);
    }

    // Site-scoped routes: look up main branch for authorization
    const mainBranch = await getMainBranch(context.siteId);
    if (mainBranch === null) {
      return errorResponse('Site not found', 404);
    }

    // Authorization for site-scoped document routes
    if (method === 'GET') {
      await assertPermission(context.principal, context.siteId, mainBranch.id, 'canView');
    } else {
      await assertPermission(context.principal, context.siteId, mainBranch.id, 'canEditDocuments');
    }

    // Handle restore action
    if (context.action === 'restore') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleRestoreDocument(context);
    }

    // Handle by-path lookup
    if (context.documentPath !== undefined) {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      return await handleGetDocumentByPath(context);
    }

    // Routes with documentId (single document operations)
    if (context.documentId !== undefined) {
      switch (method) {
        case 'GET':
          return await handleGetDocument(context);
        case 'PATCH':
          return await handleUpdateDocument(request, context);
        case 'DELETE':
          return await handleDeleteDocument(context);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Routes without documentId (collection operations)
    switch (method) {
      case 'GET':
        return await handleListDocuments(request, context);
      case 'POST':
        return await handleCreateDocument(request, context);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    const invalidRequest = validationErrorResponse(error);
    if (invalidRequest !== null) {
      return invalidRequest;
    }
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof SiteNotFoundError) {
      return errorResponse('Site not found', 404);
    }
    if (error instanceof DuplicateDocumentPathError) {
      return errorResponse('Document already exists at this path', 409);
    }
    if (error instanceof InvalidDocumentPathError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof DocumentNotFoundError) {
      return errorResponse('Document not found or not archived', 404);
    }
    if (error instanceof DocumentPathConflictError) {
      return errorResponse('Path is now occupied by another document', 409);
    }
    if (error instanceof PageConflictError) {
      return errorResponse('A page already exists at this origin path', 409);
    }
    if (error instanceof InvalidDocumentVersionParamsError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof InvalidLocaleError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof CanonicalVersionNotFoundError) {
      return errorResponse(error.message, 404);
    }
    if (error instanceof TranslationAlreadyExistsError) {
      return errorResponse(error.message, 409);
    }
    if (error instanceof AuthorityOverrideLimitError) {
      return errorResponse(error.message, 400);
    }

    // Log and return generic error for unknown errors
    console.error('Document API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
