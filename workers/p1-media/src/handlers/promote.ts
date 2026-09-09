import type { Env } from '../types';
import { validateMetadata } from '../schema';
import { getStoredAsset, promoteAsset } from '../store';
import { ALLOWED_MIME_TYPES, jsonError } from '../upload-shared';

interface PromoteRequestBody {
  metadata?: Record<string, unknown>;
}

/**
 * POST /media/:assetId/promote — turns a chat attachment into a library asset.
 *
 * This is the only way a chat upload reaches a customer's DAM, so it gates on
 * ALLOWED_MIME_TYPES (the library's set) and not the wider set chat accepts. The picker,
 * MediaFigureBlock and the Images binding all assume an image, so a promoted .md would be a
 * permanently unrenderable row. The client hides the action for text, but the client is not
 * a trust boundary.
 *
 * Metadata rides along rather than following in a PATCH: every other way into the library
 * collects alt at upload, and a promote that half-succeeded would leave an unlabelled asset
 * in the picker with nothing prompting anyone to fix it. It is layered over whatever the
 * asset already holds, so a blank field leaves that detail alone rather than clearing it.
 */
export async function handlePromote(
  request: Request,
  env: Env,
  siteId: string,
  assetId: string,
): Promise<Response> {
  let body: PromoteRequestBody = {};
  if (request.headers.get('Content-Type')?.includes('application/json')) {
    try {
      body = (await request.json()) as PromoteRequestBody;
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
  }

  let submitted: Record<string, string> | undefined;
  if (body.metadata !== undefined) {
    if (typeof body.metadata !== 'object' || body.metadata === null || Array.isArray(body.metadata)) {
      return jsonError('metadata must be an object', 400);
    }
    const valid = validateMetadata(body.metadata);
    if (!valid.ok) return jsonError(valid.error, 400);
    // Empty strings are what an untouched form field sends; storing them would put a
    // blank alt on the asset rather than leaving it unset.
    submitted = Object.fromEntries(
      Object.entries(body.metadata)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
        .map(([key, value]) => [key, value.trim()]),
    );
  }

  const stored = await getStoredAsset(env, siteId, assetId);
  if (!stored) return jsonError('Not found', 404);
  const { asset, deleted } = stored;

  // Already promoted and nothing to record: succeed, so a double-click or a retry after a
  // dropped response doesn't report a failure for work that's done. A soft-deleted asset is a
  // different case: adding it back is a real write, and the chat is the only place it can be
  // triggered from.
  //
  // Details submitted with it are not "nothing to record". The client offers the form
  // whenever its membership lookup fails, so a caller can reach here having typed alt text —
  // and short-circuiting told them it saved while dropping it.
  const hasDetails = submitted !== undefined && Object.keys(submitted).length > 0;
  if (!deleted && asset.origin !== 'chat' && !hasDetails) {
    return new Response(JSON.stringify(asset), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (asset.contentType === undefined || !ALLOWED_MIME_TYPES.has(asset.contentType)) {
    return jsonError('Only image files can be added to the media library', 415);
  }

  // Merged over the existing values, not replacing them. Re-adding a deleted asset opens an
  // empty form (the record route hides deleted rows), so replacing would wipe its details.
  const metadata = submitted === undefined
    ? undefined
    : withoutEmpty({ ...asset.metadata, ...submitted });

  const promoted = await promoteAsset(env, siteId, assetId, metadata);
  if (!promoted) return jsonError('Not found', 404);

  return new Response(JSON.stringify(promoted), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Undefined rather than an empty map, which promoteAsset would write as a null-out. */
function withoutEmpty(metadata: Record<string, string>): Record<string, string> | undefined {
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
