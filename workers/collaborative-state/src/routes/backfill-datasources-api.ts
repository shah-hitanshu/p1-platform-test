/**
 * Backfill Datasources API
 *
 * Admin endpoint to generate datasources and queries for templates
 * that were created before the auto-generation hook existed.
 * Idempotent — safe to run multiple times.
 */

import type { AuthenticatedPrincipal } from '../types';
import { query } from '../db';
import { getMainBranch } from '../services/branch-service';
import { listDocumentsOnBranch } from '../services/branch-document-service';
import { onTemplateCreated } from '../services/template-hooks';
import { jsonResponse, errorResponse } from '../utils/http-helpers';
import { isSystemAdmin } from '../utils/admin-check';

const TEMPLATE_PATH_PREFIX = '_registry/templates/';

function extractTemplateName(path: string): string | null {
  const match = /^_registry\/templates\/(.+)$/.exec(path);
  return match?.[1] ?? null;
}

interface BackfillError {
  siteId: string;
  template: string;
  error: string;
}

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;

export async function handleBackfillDatasources(
  request: Request,
  principal: AuthenticatedPrincipal,
): Promise<Response> {
  if (!(await isSystemAdmin(principal))) {
    return errorResponse('System admin role required', 403);
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const batchSize = Math.min(
    Math.max(1, parseInt(url.searchParams.get('batchSize') ?? String(DEFAULT_BATCH_SIZE), 10) || DEFAULT_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

  const sitesResult = await query<{ id: string; name: string }>(
    'SELECT id, name FROM app.sites WHERE archived_at IS NULL ORDER BY created_at LIMIT $1 OFFSET $2',
    [batchSize, offset],
  );

  let sitesProcessed = 0;
  let sitesSkipped = 0;
  let templatesProcessed = 0;
  const errors: BackfillError[] = [];

  for (const site of sitesResult.rows) {
    const mainBranch = await getMainBranch(site.id);
    if (mainBranch === null) {
      sitesSkipped++;
      continue;
    }

    const templateDocs = await listDocumentsOnBranch(mainBranch.id, {
      pathPrefix: TEMPLATE_PATH_PREFIX,
    });

    if (templateDocs.length === 0) {
      sitesSkipped++;
      continue;
    }

    sitesProcessed++;

    for (const doc of templateDocs) {
      const templateName = extractTemplateName(doc.path);
      if (templateName === null) {
        continue;
      }

      templatesProcessed++;

      const hookResult = await onTemplateCreated({
        siteId: site.id,
        branchId: mainBranch.id,
        templateName,
        templateId: doc.id,
        createdById: principal.dbUserId ?? principal.id,
      });
      for (const err of hookResult.errors) {
        errors.push({
          siteId: site.id,
          template: templateName,
          error: err,
        });
      }
    }
  }

  const hasMore = sitesResult.rows.length === batchSize;

  return jsonResponse({
    sitesProcessed,
    sitesSkipped,
    templatesProcessed,
    errors,
    batch: {
      offset,
      batchSize,
      returnedSites: sitesResult.rows.length,
      hasMore,
      nextOffset: hasMore ? offset + batchSize : undefined,
    },
  });
}
