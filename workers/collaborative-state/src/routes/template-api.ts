/**
 * Template API Routes
 *
 * REST API endpoints for template operations.
 * Templates are stored as documents at _registry/templates/:name
 */

import type { AuthenticatedPrincipal } from '../types';
import { toDocumentActorType } from '../types';
import type { Env } from '../index';
import { runWithConnection } from '../db';
import {
  createDocumentOnBranch,
  getLatestTemplateVersionWithFallback,
  listTemplatesOnBranch,
  createDocumentVersion,
  getDocument,
  getBranch,
  getBranchByName,
  getMainBranch,
  deleteDocumentOnBranch,
  DuplicateDocumentPathError,
} from '../services';
import { assertPermission, getEffectiveRole, AuthorizationError } from '../auth/authorization';
import { isManifestShapedSnapshot, convertManifestToContent } from '../services/template-content-backfill';
import { query } from '../db';
import { TEMPLATE_RELATION_INNER_JOIN } from '../services/document-queries';
import { onTemplateCreated } from '../services/template-hooks';
import {
  triggerMigration,
  processMigration,
  rollbackMigration,
  getMigrationStatus,
  previewMigration,
  TemplateNotFoundError,
  InvalidVersionRangeError,
  MigrationJobNotFoundError,
} from '../services/migration-service';

const VALID_PRINCIPAL_TYPES = new Set(['user', 'agent', 'system', 'service']);

function toPrincipalType(type: string): 'user' | 'agent' | 'system' | 'service' {
  if (VALID_PRINCIPAL_TYPES.has(type)) return type as 'user' | 'agent' | 'system' | 'service';
  throw new Error(`Invalid principal type: ${type}`);
}

function createDOReloader(env: Env) {
  return async (siteId: string, branchId: string, documentIds: string[]): Promise<void> => {
    await Promise.allSettled(
      documentIds.map(async (docId) => {
        const sessionId = `${siteId}:${docId}:${branchId}`;
        const doId = env.DOCUMENT_STATE.idFromName(sessionId);
        const stub = env.DOCUMENT_STATE.get(doId);
        await stub.fetch(new Request('http://internal/reload', {
          method: 'POST',
          headers: { 'X-Session-Id': sessionId },
        }));
      }),
    );
  };
}

/**
 * Request context for template routes
 */
export interface TemplateRouteContext {
  siteId: string;
  branchId?: string;
  templateId?: string;
  action?: 'migrate' | 'migrate-preview' | 'rollback' | 'migration-status';
  principal: AuthenticatedPrincipal;
  ctx?: ExecutionContext;
  env?: Env;
}

/**
 * Template metadata stored at root.props._template of the snapshot
 */
interface TemplateMetadata {
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated: boolean;
}

/**
 * A component entry in a legacy manifest create body.
 */
interface ManifestComponentInput {
  type: string;
  pinned?: boolean;
  defaultProps?: Record<string, unknown>;
}

/**
 * Request body for creating a template. Legacy clients include a `components`
 * manifest array, which is converted to the content shape before storage.
 */
interface CreateTemplateBody {
  name: string;
  label: string;
  description?: string;
  defaultUrlPattern?: string;
  components?: ManifestComponentInput[];
}

/**
 * Request body for updating template metadata. Legacy clients send a full
 * manifest whose `components` pin flags are folded into _pinMap; any other
 * per-component fields are ignored.
 */
interface UpdateTemplateBody {
  label?: string;
  description?: string;
  defaultUrlPattern?: string;
  deprecated?: boolean;
  components?: { type: string; pinned?: boolean }[];
}

/**
 * Extract the metadata block from a template snapshot.
 *
 * Content-shaped snapshots carry metadata at root.props._template. Pre-backfill
 * manifest snapshots carry it as top-level fields; those are read as a fallback
 * so listing and the deprecated-template guard work regardless of shape.
 */
export function templateMetadata(
  snapshot: Record<string, unknown> | undefined,
): Partial<TemplateMetadata> {
  const root = snapshot?.root as { props?: { _template?: Partial<TemplateMetadata> } } | undefined;
  const fromRoot = root?.props?._template;
  if (fromRoot) {
    return fromRoot;
  }

  if (!snapshot) {
    return {};
  }
  const legacy: Partial<TemplateMetadata> = {};
  if (typeof snapshot.label === 'string') legacy.label = snapshot.label;
  if (typeof snapshot.description === 'string') legacy.description = snapshot.description;
  if (typeof snapshot.defaultUrlPattern === 'string') legacy.defaultUrlPattern = snapshot.defaultUrlPattern;
  if (typeof snapshot.deprecated === 'boolean') legacy.deprecated = snapshot.deprecated;
  return legacy;
}

/**
 * A single component in the legacy manifest projection.
 */
interface LegacyComponent {
  type: unknown;
  pinned: boolean;
  defaultProps: Record<string, unknown>;
}

/**
 * The legacy manifest projection of a content-shaped snapshot.
 */
interface LegacyProjection {
  label: string;
  deprecated: boolean;
  description?: string;
  defaultUrlPattern?: string;
  components: LegacyComponent[];
}

/**
 * Derives the legacy manifest fields old clients read from a content-shaped
 * snapshot. `components` mirrors content order; each entry's `pinned` reflects
 * root.props._pinMap and `defaultProps` is the content item's props without id.
 */
export function legacyTemplateProjection(
  snapshot: Record<string, unknown> | undefined,
): LegacyProjection {
  const metadata = templateMetadata(snapshot);

  const root = snapshot?.root as { props?: { _pinMap?: Record<string, boolean> } } | undefined;
  const pinMap = root?.props?._pinMap ?? {};

  const rawContent = snapshot?.content;
  const content = (Array.isArray(rawContent) ? rawContent : []) as {
    type?: unknown;
    props?: Record<string, unknown>;
  }[];

  const components: LegacyComponent[] = content.map((item) => {
    const props = item.props ?? {};
    const defaultProps = { ...props };
    delete defaultProps.id;
    return {
      type: item.type,
      pinned: pinMap[props.id as string] === true,
      defaultProps,
    };
  });

  return {
    label: metadata.label ?? '',
    deprecated: metadata.deprecated ?? false,
    ...(metadata.description !== undefined && { description: metadata.description }),
    ...(metadata.defaultUrlPattern !== undefined && { defaultUrlPattern: metadata.defaultUrlPattern }),
    components,
  };
}

/**
 * Parse JSON body from request with type assertion
 */
async function parseJsonBody<T>(request: Request): Promise<T> {
  const json: unknown = await request.json();
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new InvalidBodyError();
  }
  return json as T;
}

class InvalidBodyError extends Error {
  constructor() { super('Request body must be a JSON object'); }
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
 * Extract template name from document path
 */
function extractTemplateName(path: string): string | null {
  const match = /^_registry\/templates\/(.+)$/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/templates - List Templates
 */
async function handleListTemplates(
  branchId: string,
  mainBranchId: string,
): Promise<Response> {
  const templatesOnBranch = await listTemplatesOnBranch(branchId, mainBranchId);

  const templates = templatesOnBranch
    .map((tpl) => {
      const templateName = extractTemplateName(tpl.path);
      if (tpl.snapshot === null || templateName === null) {
        return null;
      }
      const canonical: Record<string, unknown> = isManifestShapedSnapshot(tpl.snapshot)
        ? convertManifestToContent(tpl.snapshot) as unknown as Record<string, unknown>
        : tpl.snapshot;
      return {
        id: tpl.id,
        name: templateName,
        version: tpl.versionNumber,
        updatedAt: tpl.createdAt,
        ...templateMetadata(canonical),
        components: legacyTemplateProjection(canonical).components,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return jsonResponse({ templates });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/templates/{templateId} - Get Template
 */
async function handleGetTemplate(
  templateId: string,
  branchId: string,
  mainBranchId: string,
): Promise<Response> {
  // Check if template exists
  const document = await getDocument(templateId);
  if (!document) {
    return errorResponse('Template not found', 404);
  }

  // Verify it's actually a template
  if (!document.path.startsWith('_registry/templates/')) {
    return errorResponse('Document is not a template', 400);
  }

  const fallback = await getLatestTemplateVersionWithFallback(templateId, branchId, mainBranchId);
  if (!fallback) {
    return errorResponse('Template version not found', 404);
  }
  const version = fallback.version;

  const templateName = extractTemplateName(document.path);

  const canonicalSnapshot: Record<string, unknown> = isManifestShapedSnapshot(version.snapshot)
    ? convertManifestToContent(version.snapshot) as unknown as Record<string, unknown>
    : (version.snapshot ?? {});

  return jsonResponse({
    id: document.id,
    name: templateName,
    version: version.versionNumber,
    updatedAt: version.createdAt,
    ...canonicalSnapshot,
    ...legacyTemplateProjection(canonicalSnapshot),
  });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates - Create Template
 */
async function handleCreateTemplate(
  request: Request,
  siteId: string,
  branchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<CreateTemplateBody>(request);

  // Validate required fields
  if (!body.name || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }
  if (!body.label || body.label.trim() === '') {
    return errorResponse('label is required', 400);
  }

  // Validate template name format (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) {
    return errorResponse('Template name must contain only alphanumeric characters, hyphens, and underscores', 400);
  }

  const templatePath = `_registry/templates/${body.name}`;

  let snapshot: Record<string, unknown>;
  if (body.components !== undefined) {
    if (!Array.isArray(body.components)) {
      return errorResponse('components must be an array', 400);
    }
    snapshot = convertManifestToContent({
      name: body.name,
      label: body.label,
      ...(body.description !== undefined && { description: body.description }),
      ...(body.defaultUrlPattern !== undefined && { defaultUrlPattern: body.defaultUrlPattern }),
      deprecated: false,
      components: body.components,
    }) as unknown as Record<string, unknown>;
  } else {
    snapshot = {
      content: [],
      root: {
        props: {
          _template: {
            label: body.label,
            ...(body.description !== undefined && { description: body.description }),
            ...(body.defaultUrlPattern !== undefined && { defaultUrlPattern: body.defaultUrlPattern }),
            deprecated: false,
          },
          _pinMap: {},
        },
      },
      zones: {},
    };
  }

  // Create template as document
  const result = await createDocumentOnBranch({
    siteId,
    branchId,
    path: templatePath,
    snapshot: { ...snapshot },
    createdById: principal.dbUserId ?? principal.id,
    createdByType: toDocumentActorType(principal.type),
  });

  let hookWarning: string | undefined;
  const hookResult = await onTemplateCreated({
    siteId,
    branchId,
    templateName: body.name,
    templateId: result.document.id,
    createdById: principal.dbUserId ?? principal.id,
  });
  if (hookResult.errors.length > 0) {
    console.error('onTemplateCreated partial failure:', hookResult.errors);
    hookWarning = 'Auto-generated datasource/query creation failed. Use the backfill endpoint to retry.';
  }

  return jsonResponse(
    {
      id: result.document.id,
      name: body.name,
      version: result.version.versionNumber,
      updatedAt: result.version.createdAt,
      ...snapshot,
      ...legacyTemplateProjection(snapshot),
      ...(hookWarning !== undefined ? { warning: hookWarning } : {}),
    },
    201,
  );
}

/**
 * Handle PATCH /api/sites/{siteId}/branches/{branchId}/templates/{templateId} - Update Template
 */
async function handleUpdateTemplate(
  request: Request,
  templateId: string,
  branchId: string,
  mainBranchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<UpdateTemplateBody>(request);

  const document = await getDocument(templateId);
  if (!document) {
    return errorResponse('Template not found', 404);
  }

  // Verify it's actually a template
  if (!document.path.startsWith('_registry/templates/')) {
    return errorResponse('Document is not a template', 400);
  }

  // Resolve the version to merge into. Editing an inherited template seeds the
  // base from main; this write materializes the first branch-local version. A
  // template the branch has deleted (local tombstone) is treated as not found.
  const fallback = await getLatestTemplateVersionWithFallback(templateId, branchId, mainBranchId);
  if (!fallback) {
    return errorResponse('Template not found', 404);
  }
  const currentVersion = fallback.version;

  // Metadata update: replaces root.props._template, folds legacy pin flags
  // into _pinMap when the body carries a manifest, and leaves content and
  // zones untouched. Layout changes arrive only through document saves. A
  // never-backfilled manifest snapshot is converted to the content shape on
  // this write, lifting its legacy top-level metadata into _template before
  // the patch is applied.
  const currentSnapshot = currentVersion.snapshot ?? {};
  const isManifest = isManifestShapedSnapshot(currentSnapshot);
  const baseSnapshot: Record<string, unknown> = isManifest
    ? convertManifestToContent(currentSnapshot) as unknown as Record<string, unknown>
    : currentSnapshot;

  const baseRoot = (baseSnapshot.root ?? {}) as { props?: Record<string, unknown> };
  const baseRootProps = baseRoot.props ?? {};
  const currentMetadata = (baseRootProps._template ?? {}) as Record<string, unknown>;

  const patchedFields: Record<string, unknown> = {};
  if (body.label !== undefined) patchedFields.label = body.label;
  if (body.description !== undefined) patchedFields.description = body.description;
  if (body.defaultUrlPattern !== undefined) patchedFields.defaultUrlPattern = body.defaultUrlPattern;
  if (body.deprecated !== undefined) patchedFields.deprecated = body.deprecated;

  const updatedMetadata: Record<string, unknown> = {
    label: '',
    deprecated: false,
    ...currentMetadata,
    ...patchedFields,
  };

  const updatedRootProps: Record<string, unknown> = {
    ...baseRootProps,
    _template: updatedMetadata,
  };

  // Legacy pin toggles arrive as a manifest whose pins are type-keyed. Rebuild
  // _pinMap by content item: a type named in the body takes that pin, others
  // keep their current pin. Content itself is never touched here.
  if (body.components !== undefined) {
    const basePinMap = (baseRootProps._pinMap ?? {}) as Record<string, boolean>;
    const rawContent = baseSnapshot.content;
    const content = (Array.isArray(rawContent) ? rawContent : []) as {
      type?: unknown;
      props?: Record<string, unknown>;
    }[];

    const pinnedByType = new Map<string, boolean>();
    for (const entry of body.components) {
      if (entry.pinned !== undefined && !pinnedByType.has(entry.type)) {
        pinnedByType.set(entry.type, entry.pinned);
      }
    }

    const newPinMap: Record<string, boolean> = {};
    for (const item of content) {
      const id = item.props?.id as string | undefined;
      if (id === undefined) continue;
      const typeKey = item.type as string;
      const resolved = pinnedByType.has(typeKey) ? pinnedByType.get(typeKey) : basePinMap[id];
      if (resolved !== undefined) {
        newPinMap[id] = resolved;
      }
    }
    updatedRootProps._pinMap = newPinMap;
  }

  const updatedSnapshot: Record<string, unknown> = {
    ...baseSnapshot,
    root: {
      ...baseRoot,
      props: updatedRootProps,
    },
  };

  // Create new version. A manifest-to-content conversion is a representation
  // change, not an authored edit, so it is written as non-structural.
  const actorType = toDocumentActorType(principal.type);
  const version = await createDocumentVersion({
    documentId: templateId,
    branchId,
    snapshot: updatedSnapshot,
    source: 'edit',
    createdById: principal.dbUserId ?? principal.id,
    createdByType: actorType === 'service' ? 'system' : actorType,
    forceNonStructural: isManifest,
  });

  return jsonResponse({
    id: templateId,
    name: extractTemplateName(document.path),
    version: version.versionNumber,
    updatedAt: version.createdAt,
    ...updatedSnapshot,
    ...legacyTemplateProjection(updatedSnapshot),
  });
}

/**
 * Handle DELETE /api/sites/{siteId}/branches/{branchId}/templates/{templateId} - Delete Template
 */
async function handleDeleteTemplate(
  templateId: string,
  branchId: string,
  mainBranchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const document = await getDocument(templateId);
  if (!document) {
    return errorResponse('Template not found', 404);
  }

  // Verify it's actually a template
  if (!document.path.startsWith('_registry/templates/')) {
    return errorResponse('Document is not a template', 400);
  }

  // Deleting an inherited template writes a local tombstone, hiding it on this
  // branch while main keeps it. A template already deleted here is not found.
  const fallback = await getLatestTemplateVersionWithFallback(templateId, branchId, mainBranchId);
  if (!fallback) {
    return errorResponse('Template not found', 404);
  }

  // Check if any documents reference this template
  const refs = await query(
    `SELECT COUNT(*) as count
     FROM app.documents d
     ${TEMPLATE_RELATION_INNER_JOIN}
     WHERE dr.target_document_id = $1 AND d.archived_at IS NULL`,
    [templateId],
  );

  const refCount = parseInt((refs.rows[0]?.count ?? '0') as string, 10);
  if (refCount > 0) {
    return errorResponse(
      'Cannot delete template: ' + String(refCount) + ' document(s) still reference it',
      409,
    );
  }

  await deleteDocumentOnBranch({
    documentId: templateId,
    branchId,
    deletedById: principal.dbUserId ?? principal.id,
    deletedByType: toDocumentActorType(principal.type),
  });

  return new Response(null, { status: 204 });
}

/**
 * Handle GET /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migration-status
 */
async function handleMigrationStatus(
  templateId: string,
  branchId: string,
  mainBranchId: string,
): Promise<Response> {
  const status = await getMigrationStatus(templateId, branchId, mainBranchId);
  return jsonResponse(status);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate/preview
 */
async function handleMigratePreview(
  request: Request,
  siteId: string,
  branchId: string,
  mainBranchId: string,
  templateId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const detail = url.searchParams.get('detail') === 'true';

  const body = await parseJsonBody<{ fromVersion?: number; toVersion?: number }>(request);

  let toVersion = body.toVersion;
  if (toVersion === undefined) {
    const latest = await getLatestTemplateVersionWithFallback(templateId, branchId, mainBranchId);
    if (!latest) {
      return errorResponse('Template version not found', 404);
    }
    toVersion = latest.version.versionNumber;
  }

  const fromVersion = body.fromVersion ?? Math.max(toVersion - 1, 0);

  const preview = await previewMigration(
    siteId, branchId, templateId, fromVersion, toVersion, detail, mainBranchId,
  );
  return jsonResponse(preview);
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/migrate
 */
async function handleMigrateTemplate(
  request: Request,
  siteId: string,
  branchId: string,
  mainBranchId: string,
  templateId: string,
  principal: AuthenticatedPrincipal,
  ctx?: ExecutionContext,
  env?: Env,
): Promise<Response> {
  const body = await parseJsonBody<{ fromVersion?: number; toVersion?: number }>(request);

  let toVersion = body.toVersion;
  if (toVersion === undefined) {
    const latest = await getLatestTemplateVersionWithFallback(templateId, branchId, mainBranchId);
    if (!latest) {
      return errorResponse('Template version not found', 404);
    }
    toVersion = latest.version.versionNumber;
  }

  const fromVersion = body.fromVersion ?? Math.max(toVersion - 1, 0);

  const actorType = toPrincipalType(principal.type);
  const migrationPrincipal = {
    id: principal.dbUserId ?? principal.id,
    // A service principal migrates as a system actor — the only non-human type
    // the migration audit trail records.
    type: actorType === 'service' ? 'system' : actorType,
  };

  const job = await triggerMigration(
    siteId, branchId, templateId, fromVersion, toVersion, migrationPrincipal, mainBranchId,
  );

  // Process migration asynchronously — return the job immediately so the
  // HTTP request doesn't timeout for large document sets.
  // Must wrap in its own runWithConnection because ctx.waitUntil runs after
  // the request's database connection scope has closed.
  const reloadDOs = env ? createDOReloader(env) : undefined;

  if (ctx && env) {
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_CONNECTION_STRING ?? '';
    ctx.waitUntil(
      runWithConnection(connectionString, { isHyperdrive: env.HYPERDRIVE !== undefined }, () =>
        processMigration(job.id, reloadDOs, mainBranchId),
      ).catch(async (err: unknown) => {
        console.error('Background migration failed:', err);
        try {
          await runWithConnection(connectionString, { isHyperdrive: env.HYPERDRIVE !== undefined }, () =>
            query('UPDATE app.migration_jobs SET status = \'failed\' WHERE id = $1', [job.id]),
          );
        } catch (updateErr: unknown) {
          console.error('Failed to update job status after background failure:', updateErr);
        }
      }),
    );
    return jsonResponse({ job, status: 'processing' }, 202);
  }

  // Fallback for environments without ExecutionContext (tests, local dev without wrangler)
  const result = await processMigration(job.id, reloadDOs, mainBranchId);
  return jsonResponse({ job, ...result });
}

/**
 * Handle POST /api/sites/{siteId}/branches/{branchId}/templates/{templateId}/rollback
 */
async function handleRollbackTemplate(
  request: Request,
  siteId: string,
  templateId: string,
  branchId: string,
  mainBranchId: string,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  const body = await parseJsonBody<{ jobId: string }>(request);

  const actorType = toPrincipalType(principal.type);
  const migrationPrincipal = {
    id: principal.dbUserId ?? principal.id,
    // A service principal migrates as a system actor — the only non-human type
    // the migration audit trail records.
    type: actorType === 'service' ? 'system' : actorType,
  };

  const result = await rollbackMigration(body.jobId, migrationPrincipal, {
    siteId,
    branchId,
    templateId,
  }, mainBranchId);

  return jsonResponse(result);
}

/**
 * Main route handler for template operations
 */
export async function handleTemplateRequest(
  request: Request,
  context: TemplateRouteContext,
): Promise<Response> {
  const method = request.method;

  try {
    if (context.branchId === undefined || context.branchId === '') {
      return errorResponse('Branch ID is required', 400);
    }

    // Resolve branch by UUID or name
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const branch = uuidPattern.test(context.branchId)
      ? await getBranch(context.branchId)
      : await getBranchByName(context.siteId, context.branchId);
    if (branch?.siteId !== context.siteId) {
      return errorResponse('Branch not found', 404);
    }

    const branchId = branch.id;

    // Non-main branches inherit templates from main via copy-on-write; resolve
    // main so reads can fall back to it. On main, mainBranchId === branchId
    // disables the fallback.
    const mainBranch = branch.isMain ? null : await getMainBranch(context.siteId);
    const mainBranchId = mainBranch?.id ?? branchId;

    // Handle migration-status action
    if (context.action === 'migration-status' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'GET') {
        return errorResponse('Method not allowed', 405);
      }
      await assertPermission(context.principal, context.siteId, branchId, 'canView');
      return await handleMigrationStatus(context.templateId, branchId, mainBranchId);
    }

    // Handle migrate-preview action
    if (context.action === 'migrate-preview' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Template migration preview requires ADMIN role', 'canEditDocuments', roleName);
      }
      return await handleMigratePreview(request, context.siteId, branchId, mainBranchId, context.templateId);
    }

    // Handle migrate action
    if (context.action === 'migrate' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      // Check ADMIN role for migration
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Template migration requires ADMIN role', 'canEditDocuments', roleName);
      }
      return await handleMigrateTemplate(
        request, context.siteId, branchId, mainBranchId, context.templateId,
        context.principal, context.ctx, context.env,
      );
    }

    // Handle rollback action
    if (context.action === 'rollback' && context.templateId !== undefined && context.templateId !== '') {
      if (method !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }
      // Check ADMIN role for rollback
      const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
      if (roleName !== 'ADMIN') {
        throw new AuthorizationError('Template rollback requires ADMIN role', 'canEditDocuments', roleName);
      }
      return await handleRollbackTemplate(
        request, context.siteId, context.templateId, branchId, mainBranchId, context.principal,
      );
    }

    // Authorization for standard CRUD operations
    if (method === 'GET') {
      await assertPermission(context.principal, context.siteId, branchId, 'canView');
    } else if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      if (context.principal.type === 'service') {
        await assertPermission(context.principal, context.siteId, branchId, 'canEditDocuments');
      } else {
        const { roleName } = await getEffectiveRole(context.principal, context.siteId, branchId);
        if (roleName !== 'ADMIN') {
          throw new AuthorizationError('Template write operations require ADMIN role', 'canEditDocuments', roleName);
        }
      }
    }

    // Routes with templateId
    if (context.templateId !== undefined && context.templateId !== '') {
      switch (method) {
        case 'GET':
          return await handleGetTemplate(context.templateId, branchId, mainBranchId);
        case 'PATCH':
          return await handleUpdateTemplate(request, context.templateId, branchId, mainBranchId, context.principal);
        case 'DELETE':
          return await handleDeleteTemplate(context.templateId, branchId, mainBranchId, context.principal);
        default:
          return errorResponse('Method not allowed', 405);
      }
    }

    // Collection routes
    switch (method) {
      case 'GET':
        return await handleListTemplates(branchId, mainBranchId);
      case 'POST':
        return await handleCreateTemplate(request, context.siteId, branchId, context.principal);
      default:
        return errorResponse('Method not allowed', 405);
    }
  } catch (error) {
    // Handle known errors
    if (error instanceof InvalidBodyError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof AuthorizationError) {
      return errorResponse(error.message, 403);
    }
    if (error instanceof InvalidVersionRangeError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof TemplateNotFoundError) {
      return errorResponse(error.message, 404);
    }
    if (error instanceof MigrationJobNotFoundError) {
      return errorResponse(error.message, 404);
    }
    if (error instanceof DuplicateDocumentPathError) {
      return errorResponse('Template already exists at this path', 409);
    }

    if (error instanceof SyntaxError) {
      return errorResponse('Invalid JSON in request body', 400);
    }

    // Log and return generic error for unknown errors
    console.error('Template API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
