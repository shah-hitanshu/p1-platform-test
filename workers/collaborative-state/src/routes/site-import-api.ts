/**
 * Site Import Route Handler (PCC-3249 / PROPOSAL-013)
 *
 * POST /api/admin/sites/{siteId}/import
 *
 * Accepts multipart/form-data with fields:
 *   file            - ZIP bundle (required)
 *   bundleSignature - HMAC-SHA256 of bundle.json from the export response (required)
 *
 * Validates SHA-256 manifest and bundle signature, then processes in dependency order:
 *   site → branches → documents → versions → checkpoints
 *
 * Idempotent: re-running resumes from KV progress manifest. The empty-site check
 * is skipped when KV progress already exists for this bundle, allowing resume after
 * partial completion. NOTE: resume only works for the same bundle (same exportedAt);
 * a different bundle into the same site requires a fresh empty site.
 *
 * Version numbers on target are sequential (1, 2, 3...) ordered by createdAt;
 * source version numbers are stored in import_id_maps for traceability.
 */
import { unzipSync } from 'fflate';
import type { AuthenticatedPrincipal } from '../types';
import { getSite, updateSite } from '../services/site-service';

import { getMainBranch, createBranch, listBranches } from '../services/branch-service';
import { createCheckpoint } from '../services/checkpoint-service';
import { createDocument, listDocuments } from '../services/document-service';
import { createDocumentVersion } from '../services/document-version-service';
import {
  validateBundleManifest,
  verifyBundleSignature,
  buildImportKey,
  getImportProgress,
  saveImportProgress,
  hasCompletedPhase,
  resolveCreatedByRefToId,
  type BundleManifest,
  type ImportProgress,
} from '../services/bundle-import-service';
import type { CreatedByRef } from '../services/bundle-export-service';
import { assertPermission, AuthorizationError } from '../auth/authorization';
import { query } from '../db';
import { jsonResponse, errorResponse } from '../utils/http-helpers';

const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';
const REGISTRY_PREFIX = '_registry/';

export interface SiteImportRouteContext {
  siteId?: string;
  principal: AuthenticatedPrincipal;
}

export interface SiteImportEnv {
  CONFIG_KV: KVNamespace;
  INTERNAL_SECRET: string;
}

export async function handleSiteImportRoute(
  request: Request,
  context: SiteImportRouteContext,
  env: SiteImportEnv,
): Promise<Response> {
  const { siteId, principal } = context;

  if (siteId === undefined || siteId.trim() === '') {
    return errorResponse('Site ID is required', 400);
  }
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const mainBranch = await getMainBranch(siteId);
    if (mainBranch === null) return errorResponse('Site not found', 404);

    if (principal.type !== 'service') {
      await assertPermission(principal, siteId, mainBranch.id, 'canManageGrants');
    }

    const site = await getSite(siteId);
    if (site === null) return errorResponse('Site not found', 404);

    // Parse multipart upload
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return errorResponse('Expected multipart/form-data with a "file" field', 400);
    }
    const formData = await request.formData();
    const fileField = formData.get('file') as unknown;
    if (fileField === null || typeof fileField === 'string' || !(fileField instanceof Blob)) {
      return errorResponse('Missing or invalid "file" field', 400);
    }

    // Require the bundle signature before the expensive ZIP decompression below.
    // The signature is a plain multipart form field (not inside the ZIP), so this fails
    // fast on unsigned uploads. It is verified once bundle.json is available (further down);
    // INTERNAL_SECRET presence is guaranteed by the route dispatcher (returns 503 if absent).
    const providedSignature = formData.get('bundleSignature');
    if (typeof providedSignature !== 'string' || providedSignature === '') {
      return errorResponse('bundleSignature is required', 400);
    }

    const zipBytes = new Uint8Array(await fileField.arrayBuffer());

    // Decompress ZIP
    let zipContents: Record<string, Uint8Array>;
    try {
      zipContents = unzipSync(zipBytes);
    } catch {
      return errorResponse('Failed to decompress ZIP bundle', 400);
    }

    // Read bundle.json (manifest container — NOT in manifest.files)
    const bundleJsonBytes = zipContents['bundle.json'];
    if (bundleJsonBytes === undefined) {
      return errorResponse('bundle.json not found in ZIP', 422);
    }

    // Verify the signature now that bundle.json is available. The signature covers bundle.json,
    // which in turn covers all other files via SHA-256, preventing tampered bundles.
    const valid = await verifyBundleSignature(bundleJsonBytes, providedSignature, env.INTERNAL_SECRET);
    if (!valid) {
      return errorResponse('Bundle signature verification failed — bundle may have been tampered with', 422);
    }

    const manifest = JSON.parse(new TextDecoder().decode(bundleJsonBytes)) as BundleManifest;

    // Validate SHA-256 hashes of all files listed in manifest.files.
    // bundle.json itself is excluded — it is the manifest container.
    // Validation always re-runs even on resume to ensure integrity on every attempt.
    const validation = await validateBundleManifest(manifest, zipContents);
    if (!validation.valid) {
      return errorResponse('Bundle manifest validation failed', 422, validation.errors);
    }

    const importKey = buildImportKey(siteId, manifest.exportedAt);
    let progress = await getImportProgress(env.CONFIG_KV, importKey);

    // Empty-site check: only enforce for first-time imports (no KV progress).
    // On resume (progress exists), the site already has data from the previous run.
    // Store existingBranches so it can be reused in the branches-resume path below.
    const [existingDocs, existingBranches] = await Promise.all([
      listDocuments(siteId),
      listBranches(siteId),
    ]);
    if (progress === null) {
      // Exclude the auto-seeded root page ('/') from the emptiness check
      const hasNonRegistryDocs = existingDocs.some((d) => !d.path.startsWith(REGISTRY_PREFIX) && d.path !== '/');
      const hasNonMainBranches = existingBranches.some((b) => !b.isMain);
      if (hasNonRegistryDocs || hasNonMainBranches) {
        return errorResponse(
          'Target site is not empty. Import only supports empty sites.',
          409,
        );
      }
    }

    // Cross-site import note: manifest.sourceSiteId may differ from siteId (this is
    // the intended migration use case). Log for audit purposes.
    if (manifest.sourceSiteId !== siteId) {
      console.info(
        `[bundle-import] Cross-site import: source=${manifest.sourceSiteId} target=${siteId}`,
      );
    }

    // --- Phase: site ---
    if (!hasCompletedPhase(progress, 'site')) {
      const siteData = JSON.parse(
        new TextDecoder().decode(zipContents['site.json']),
      ) as { name: string; workflowSettings: Record<string, unknown>; url?: string };
      // Only name and workflowSettings are synced — intentionally:
      // - pantheonSiteId: target keeps its own (environment-specific)
      // - url: environment-specific; set separately per environment
      // - createdAt/updatedAt: target records its own timestamps
      // - allowedOrigins/tokens: excluded from bundle by design (secrets/env-specific)
      await updateSite(siteId, {
        name: siteData.name,
        workflowSettings: siteData.workflowSettings,
      });
      progress = markPhaseComplete(progress, 'site');
      await saveImportProgress(env.CONFIG_KV, importKey, progress);
    }

    // --- Phase: branches ---
    // Build source→target branch name map. Main branch always exists on target.
    const sourceBranches = JSON.parse(
      new TextDecoder().decode(zipContents['branches.json']),
    ) as {
      id: string;
      name: string;
      isMain: boolean;
      status: string;
      sourceBranchId?: string;
      createdAt: string;
    }[];

    const branchNameToTargetId = new Map<string, string>();
    branchNameToTargetId.set('main', mainBranch.id); // target main branch already exists

    if (!hasCompletedPhase(progress, 'branches')) {
      // Get-or-create the import base checkpoint. A partial previous run may have
      // already created it, so look it up before inserting to avoid duplicates.
      const existingCp = await query<{ id: string }>(
        `SELECT id FROM app.checkpoints WHERE branch_id = $1 AND name = 'Import base'
         AND message = $2 LIMIT 1`,
        [mainBranch.id, `Import base for bundle exported at ${manifest.exportedAt}`],
      );
      const importBaseCheckpointId = existingCp.rows[0]?.id
        ?? (await createCheckpoint({
          branchId: mainBranch.id,
          name: 'Import base',
          message: `Import base for bundle exported at ${manifest.exportedAt}`,
          checkpointType: 'manual',
          createdById: SYSTEM_UUID,
          createdByType: 'system',
        })).checkpoint.id;

      // Keyed by name: used for get-or-create so a partial previous run doesn't
      // cause createBranch to throw on a branch that already exists.
      const existingBranchByName = new Map(
        existingBranches.filter((b) => !b.isMain).map((b) => [b.name, b.id]),
      );

      for (const srcBranch of sourceBranches) {
        if (srcBranch.isMain) continue; // target main already exists

        // get-or-create: if a previous partial run created this branch, reuse it
        const existingId = existingBranchByName.get(srcBranch.name);
        let targetBranchId: string;
        if (existingId !== undefined) {
          targetBranchId = existingId;
        } else {
          // Intentional topology flattening: all non-main branches are created as
          // direct children of main on the target, regardless of the source topology.
          // A branch-of-a-branch on the source becomes a direct child of main here.
          // The source's sourceBranchId is preserved in branches.json for reference
          // but not honoured — a two-pass approach (topological sort + parent mapping)
          // would be needed to restore the exact hierarchy (tracked in PCC-3254).
          // CreateBranchParams.createdByType only accepts 'user' | 'agent' — not 'system'
          const newBranch = await createBranch({
            siteId,
            name: srcBranch.name,
            sourceBranchId: mainBranch.id,
            sourceCheckpointId: importBaseCheckpointId,
            createdById: SYSTEM_UUID,
            createdByType: 'user', // fallback for system-originated branches
          });
          targetBranchId = newBranch.id;
        }
        branchNameToTargetId.set(srcBranch.name, targetBranchId);
        // ON CONFLICT DO NOTHING is idempotent across partial runs
        await query(
          `INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [importKey, srcBranch.id, targetBranchId, 'branch'],
        );
      }
      progress = markPhaseComplete(progress, 'branches');
      await saveImportProgress(env.CONFIG_KV, importKey, progress);
    } else {
      // Re-run: reload branch name→target mapping from the target's current branches.
      // import_id_maps records the source→target UUID mapping for traceability, but
      // branchNameToTargetId is keyed by name, which is stable across runs and more
      // reliable than reloading from import_id_maps (which stores UUIDs only).
      // Reuse existingBranches already fetched in the empty-site check above.
      for (const b of existingBranches) {
        branchNameToTargetId.set(b.name, b.id);
      }
    }

    // --- Phase: documents ---
    // Enumerate document paths from ZIP: keys matching documents/{path}/meta.json
    const documentPaths = Object.keys(zipContents)
      .filter((k) => /^documents\/(.+)\/meta\.json$/.exec(k) !== null)
      .map((k) => k.replace(/^documents\//, '').replace(/\/meta\.json$/, ''));

    for (const docPath of documentPaths) {
      const phaseKey = `document:${docPath}`;
      if (hasCompletedPhase(progress, phaseKey)) continue;

      // get-or-create: a partial previous run may have created this document.
      // createDocument would throw a unique-constraint error on retry without this.
      const existingDocRow = await query<{ id: string }>(
        'SELECT id FROM app.documents WHERE site_id = $1 AND path = $2',
        [siteId, docPath],
      );
      const newDoc = existingDocRow.rows[0] ?? await createDocument({ siteId, path: docPath });

      // Store source→target document mapping
      const metaBytes = zipContents[`documents/${docPath}/meta.json`];
      if (metaBytes !== undefined) {
        const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as { id: string };
        await query(
          `INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [importKey, meta.id, newDoc.id, 'document'],
        );
      }

      // Parse versions.jsonl — lines sorted by createdAt ASC
      const versionsKey = `documents/${docPath}/versions.jsonl`;
      const versionsBytes = zipContents[versionsKey];
      if (versionsBytes !== undefined && versionsBytes.length > 0) {
        const lines = new TextDecoder().decode(versionsBytes)
          .split('\n')
          .filter((l) => l.trim() !== '');

        // Group by branchName, maintaining createdAt order within each group
        const byBranch = new Map<string, {
          branchName: string;
          versionNumber: number;
          isPublished: boolean;
          snapshot: Record<string, unknown>;
          createdAt: string;
          createdByRef: CreatedByRef;
        }[]>();

        for (const line of lines) {
          const entry = JSON.parse(line) as {
            branchName: string;
            versionNumber: number;
            isPublished: boolean;
            snapshot: Record<string, unknown>;
            createdAt: string;
            createdByRef: CreatedByRef;
          };
          const group = byBranch.get(entry.branchName) ?? [];
          group.push(entry);
          byBranch.set(entry.branchName, group);
        }

        for (const [branchName, entries] of byBranch) {
          const targetBranchId = branchNameToTargetId.get(branchName);
          if (targetBranchId === undefined) {
            console.warn(
              `[bundle-import] Branch "${branchName}" not found in target — skipping` +
              ` ${String(entries.length)} version(s) for doc ${docPath}`,
            );
            continue;
          }

          // Skip versions already inserted in a partial previous run.
          // createDocumentVersion assigns sequential numbers (1, 2, 3...); count
          // what already exists to know where to resume.
          const existingVersionCount = await query<{ cnt: string }>(
            'SELECT COUNT(*)::text AS cnt FROM app.document_versions WHERE document_id = $1 AND branch_id = $2',
            [newDoc.id, targetBranchId],
          );
          const alreadyInserted = parseInt(existingVersionCount.rows[0]?.cnt ?? '0', 10);
          const entriesToInsert = entries.slice(alreadyInserted);

          for (const entry of entriesToInsert) {
            const createdById = await resolveCreatedByRefToId(entry.createdByRef);
            const createdByType = entry.createdByRef.type;

            const newVersion = await createDocumentVersion({
              documentId: newDoc.id,
              branchId: targetBranchId,
              snapshot: entry.snapshot,
              source: 'edit', // 'import' is not a valid DocumentVersionSource; use 'edit'
              createdById,
              createdByType,
              skipDuplicateCheck: true,
              skipCompaction: true,
            });

            // Store source version number mapping
            await query(
              `INSERT INTO app.import_id_maps (import_key, source_id, target_id, entity_type)
               VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [
                importKey,
                // Include docPath so version keys are unique across documents.
                // Without it, every doc independently starts at v1 so 'main:1'
                // collides across all docs and ON CONFLICT DO NOTHING silently
                // drops all but the first mapping.
                `${docPath}:${entry.branchName}:${String(entry.versionNumber)}`,
                String(newVersion.versionNumber),
                'version',
              ],
            );

            // Create publish checkpoint if this version was published.
            // NOTE: publish_checkpoints.jsonl in the bundle is exported for human inspection
            // and future extensibility, but is NOT consumed here. The authoritative source
            // for publish status during import is the `isPublished` field in versions.jsonl,
            // making the bundle self-contained without the .jsonl file.
            // NOTE: app.checkpoints has NO site_id column. Columns are:
            //   branch_id, name, checkpoint_type, created_by_id, created_by_type, status
            // Match the pattern used in checkpoint-publish.ts.
            if (entry.isPublished) {
              const cpResult = await query<{ id: string }>(
                `INSERT INTO app.checkpoints
                   (branch_id, name, checkpoint_type, created_by_id, created_by_type, status)
                 VALUES ($1, $2, 'publish', $3, $4, 'completed')
                 RETURNING id`,
                [targetBranchId, `Import: ${docPath} v${String(newVersion.versionNumber)}`, createdById, createdByType],
              );
              const cpId = cpResult.rows[0]?.id;
              if (cpId !== undefined) {
                await query(
                  `INSERT INTO app.checkpoint_documents (checkpoint_id, document_id, document_version_id)
                   VALUES ($1, $2, $3)`,
                  [cpId, newDoc.id, newVersion.id],
                );
              }
            }
          }
        }
      }

      progress = markPhaseComplete(progress, phaseKey);
      await saveImportProgress(env.CONFIG_KV, importKey, progress);
    }

    // Read collaborators manifest — surfaced in response so the operator knows
    // which users and agents need to be added to the target site manually.
    const collaboratorsBytes = zipContents['collaborators.json'];
    const collaborators = collaboratorsBytes !== undefined
      ? (JSON.parse(new TextDecoder().decode(collaboratorsBytes)) as {
          users: { email: string; name: string; role: string }[];
          agents: { name: string; role: string }[];
        })
      : null;

    return jsonResponse({
      importKey,
      completedPhases: progress?.completedPhases ?? [],
      documentCount: documentPaths.length,
      sourceSiteId: manifest.sourceSiteId,
      crossSiteImport: manifest.sourceSiteId !== siteId,
      ...(collaborators !== null ? { requiresSetup: { collaborators } } : {}),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return errorResponse(error.message, 403);
    console.error('[site-import] Error processing import bundle:', error);
    return errorResponse('Internal server error', 500);
  }
}

function markPhaseComplete(progress: ImportProgress | null, phase: string): ImportProgress {
  const now = new Date().toISOString();
  if (progress === null) {
    return {
      completedPhases: [phase],
      errors: [],
      startedAt: now,
      lastUpdatedAt: now,
    };
  }
  return {
    ...progress,
    completedPhases: [...new Set([...progress.completedPhases, phase])],
    lastUpdatedAt: now,
  };
}
