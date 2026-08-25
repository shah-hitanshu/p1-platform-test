/**
 * Site Export Route Handler (PCC-3249 / PROPOSAL-013)
 *
 * GET /api/admin/sites/{siteId}/export
 *
 * Assembles a full site bundle as a ZIP file, writes it to R2, and returns
 * a presigned download URL (7-day TTL). Requires canManageGrants permission
 * (admin-level) or a read:all / write:create scoped SAT token.
 *
 * Bundle structure:
 *   bundle.json                             - metadata + SHA-256 manifest (not self-hashed)
 *   site.json                               - site record (no secrets)
 *   branches.json                           - all branches
 *   documents/{path}/meta.json              - document metadata
 *   documents/{path}/versions.jsonl         - versions for all branches (includes branchName)
 *   documents/{path}/publish_checkpoints.jsonl
 *
 * NOTE: Bundle content is assembled in memory before ZIPping. Cloudflare
 * Workers memory limit is 128MB. For very large sites, use the SQL migration path.
 *
 * NOTE: bundle.json is NOT included in manifest.files — it is the manifest container
 * and therefore cannot self-reference its own hash.
 */
import { zipSync, strToU8 } from 'fflate';
import type { AuthenticatedPrincipal } from '../types';
import { getSite } from '../services/site-service';
import { listBranches, getMainBranch } from '../services/branch-service';
import { listDocuments } from '../services/document-service';
import { listRolesBySite as listAgentRolesBySite } from '../services/agent-site-role-service';
import { query } from '../db';
import {
  selectVersionsForDocument,
  resolveCreatedByRefsBatch,
  getPublishCheckpointsForDocument,
  signBundleJson,
} from '../services/bundle-export-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { signR2GetUrl } from '../storage/r2-presign';
import { sha256Hex } from '../utils/hash';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

export interface SiteExportRouteContext {
  siteId?: string;
  principal: AuthenticatedPrincipal;
}

export interface SiteExportEnv {
  ENVIRONMENT?: string;
  INTERNAL_SECRET?: string;
  R2_BUNDLES?: R2Bucket;
  R2_BUNDLES_BUCKET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

const BUNDLE_VERSION = '1';
const PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REGISTRY_PREFIX = '_registry/';

export async function handleSiteExportRoute(
  request: Request,
  context: SiteExportRouteContext,
  env: SiteExportEnv,
): Promise<Response> {
  const { siteId, principal } = context;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) return errorResponse('Site not found', 404);

    // Service principals are already scope-checked by isServicePrincipalAllowed in index.ts.
    // Only run the role-based permission check for user and agent principals.
    if (principal.type !== 'service') {
      await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');
    }

    const site = await getSite(siteId);
    if (site === null) return errorResponse('Site not found', 404);

    if (
      env.R2_BUNDLES === undefined ||
      env.R2_BUNDLES_BUCKET === undefined || env.R2_BUNDLES_BUCKET === '' ||
      env.R2_ACCOUNT_ID === undefined || env.R2_ACCOUNT_ID === '' ||
      env.R2_ACCESS_KEY_ID === undefined || env.R2_ACCESS_KEY_ID === '' ||
      env.R2_SECRET_ACCESS_KEY === undefined || env.R2_SECRET_ACCESS_KEY === ''
    ) {
      console.error('[site-export] R2 bundle storage not configured');
      return errorResponse('Bundle storage is not configured', 503);
    }

    if (env.INTERNAL_SECRET === undefined || env.INTERNAL_SECRET === '') {
      console.error('[site-export] INTERNAL_SECRET not configured — cannot sign bundle');
      return errorResponse('Bundle signing is not available on this server', 503);
    }

    const exportedAt = new Date().toISOString();
    const environment = env.ENVIRONMENT ?? 'local';

    const [branches, allDocuments] = await Promise.all([
      listBranches(siteId),
      listDocuments(siteId),
    ]);

    const documents = allDocuments.filter((d) => !d.path.startsWith(REGISTRY_PREFIX));
    const branchIsMainMap = new Map(branches.map((b) => [b.id, b.isMain]));

    const files: Record<string, Uint8Array> = {};

    // site.json — omit secrets (allowedOrigins, tokens excluded by design)
    files['site.json'] = strToU8(JSON.stringify({
      id: site.id,
      pantheonSiteId: site.pantheonSiteId,
      name: site.name,
      url: site.url,
      workflowSettings: site.workflowSettings,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    }, null, 2));

    // branches.json
    files['branches.json'] = strToU8(JSON.stringify(branches.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      status: b.status,
      isMain: b.isMain,
      sourceBranchId: b.sourceBranchId,
      sourceCheckpointId: b.sourceCheckpointId,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      archivedAt: b.archivedAt,
    })), null, 2));

    // documents/ — two-pass to batch-resolve createdByRefs (avoids N+1 DB queries).

    // Pass 1: collect all selected versions across all docs and branches.
    interface VersionEntry { docId: string; safePath: string; branchName: string; v: import('../services/bundle-export-service').SelectedVersion }
    const allEntries: VersionEntry[] = [];

    for (const doc of documents) {
      const safePath = doc.path.replace(/^\//, '');
      files[`documents/${safePath}/meta.json`] = strToU8(
        JSON.stringify({ id: doc.id, path: doc.path, createdAt: doc.createdAt }, null, 2),
      );
      for (const branch of branches) {
        const isMain = branchIsMainMap.get(branch.id) ?? false;
        const selected = await selectVersionsForDocument(doc.id, branch.id, isMain);
        for (const v of selected) {
          allEntries.push({ docId: doc.id, safePath, branchName: branch.name, v });
        }
      }
    }

    // Pass 2: batch-resolve all createdByRefs (≤2 DB round trips regardless of volume).
    const refMap = await resolveCreatedByRefsBatch(allEntries.map((e) => e.v));

    // Pass 3: build JSONL and checkpoint files per document.
    for (const doc of documents) {
      const safePath = doc.path.replace(/^\//, '');
      const docEntries = allEntries.filter((e) => e.docId === doc.id);

      // Collect versions from all branches. Each line includes branchName so the
      // import handler can map them to the correct target branch.
      // Sort by createdAt ascending (not versionNumber — version numbers are per-branch
      // and can collide across branches).
      const versionLines = docEntries
        .map((e) => ({
          createdAt: e.v.createdAt,
          line: JSON.stringify({
            branchName: e.branchName,
            versionNumber: e.v.versionNumber,
            isPublished: e.v.isPublished,
            snapshot: e.v.snapshot,
            createdAt: e.v.createdAt,
            createdByRef: refMap.get(e.v.createdById) ?? { type: 'system' },
          }),
        }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      files[`documents/${safePath}/versions.jsonl`] = strToU8(
        versionLines.map((v) => v.line).join('\n'),
      );

      // publish_checkpoints.jsonl — included for human inspection and future extensibility.
      // The import handler does NOT consume this file directly; it reconstructs publish
      // checkpoints from the `isPublished` flag on each line of versions.jsonl, which is
      // the authoritative source during import (the file is self-contained without this).
      const checkpoints = await getPublishCheckpointsForDocument(doc.id);
      files[`documents/${safePath}/publish_checkpoints.jsonl`] = strToU8(
        checkpoints.map((r) => JSON.stringify(r)).join('\n'),
      );
    }

    // collaborators.json — users and agents with site roles.
    // Included so the operator knows who needs to be added to the target site after import.
    // The import handler does NOT create these automatically; it surfaces them in the response.
    const [userRoleRows, agentRoles] = await Promise.all([
      query<{ email: string; name: string; role: string }>(
        `SELECT u.email, u.name, usr.role
         FROM app.user_site_roles usr
         JOIN app.users u ON u.id::text = usr.user_id
         WHERE usr.site_id = $1
         ORDER BY u.email`,
        [siteId],
      ),
      listAgentRolesBySite(siteId),
    ]);
    files['collaborators.json'] = strToU8(JSON.stringify({
      users: userRoleRows.rows.map((r) => ({ email: r.email, name: r.name, role: r.role })),
      agents: agentRoles.map((r) => ({ name: r.agentName, role: r.role })),
    }, null, 2));

    // Compute SHA-256 manifest over all files (bundle.json is NOT included — it is the container)
    const manifest: Record<string, string> = {};
    for (const [filePath, content] of Object.entries(files)) {
      manifest[filePath] = await sha256Hex(content);
    }
    const bundleJsonBytes = strToU8(JSON.stringify({
      bundleVersion: BUNDLE_VERSION,
      exportedAt,
      sourceEnvironment: environment,
      sourceSiteId: siteId,
      files: manifest,
    }, null, 2));
    files['bundle.json'] = bundleJsonBytes;

    // Sign bundle.json with INTERNAL_SECRET so the import handler can detect tampering.
    // The signature covers bundle.json, which in turn covers all other files via SHA-256.
    // Guarded above: the handler already 503s when INTERNAL_SECRET is unset.
    const bundleSignature = await signBundleJson(bundleJsonBytes, env.INTERNAL_SECRET);

    const zipBuffer = zipSync(files, { level: 6 });
    const safeTimestamp = exportedAt.replace(/:/g, '-');
    const r2Key = `${siteId}/${safeTimestamp}.zip`;

    await env.R2_BUNDLES.put(r2Key, zipBuffer, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: { sourceSiteId: siteId, exportedAt, bundleVersion: BUNDLE_VERSION },
    });

    const signed = await signR2GetUrl({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUNDLES_BUCKET,
      key: r2Key,
      ttlSeconds: PRESIGN_TTL_SECONDS,
    });

    return jsonResponse({
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
      exportedAt,
      bundleKey: r2Key,
      bundleSignature,
      documentCount: documents.length,
      branchCount: branches.length,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return errorResponse(error.message, 403);
    console.error('[site-export] Error generating export bundle:', error);
    return errorResponse('Internal server error', 500);
  }
}

