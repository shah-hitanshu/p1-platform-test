import type { Env } from '../types';
import { validateMetadata } from '../schema';
import { sanitizeFilename, buildKey, assertOwnedAsset, NotFoundError } from '../store';
import { createPresignedPutUrl } from '../r2-presign';
import { ALLOWED_MIME_TYPES, DEFAULT_MAX_UPLOAD_BYTES, jsonError } from '../upload-shared';

interface PresignRequestBody {
  filename?: unknown;
  contentType?: unknown;
  size?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Shared presign-mint logic for both new-asset upload and add-version. Validates
 * everything that can be validated before any bytes exist: metadata, declared
 * contentType, declared size, and filename. Mints assetId/versionId and signs a
 * presigned PUT URL — no D1 write happens here (see finalize.ts for that).
 */
export async function parsePresignRequest(
  request: Request,
  env: Env,
): Promise<
  | Response
  | {
      filename: string;
      contentType: string;
      metadata?: Record<string, string>;
    }
> {
  let body: PresignRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const maxBytes = parseInt(env.MAX_UPLOAD_BYTES ?? '', 10) || DEFAULT_MAX_UPLOAD_BYTES;

  if (typeof body.contentType !== 'string' || !ALLOWED_MIME_TYPES.has(body.contentType)) {
    return jsonError('Only image files are accepted (png, jpeg, gif, webp, avif)', 415);
  }

  if (typeof body.size !== 'number' || !(body.size > 0)) {
    return jsonError('size must be a positive number', 400);
  }
  if (body.size > maxBytes) {
    const mb = Math.round(maxBytes / 1024 / 1024);
    return jsonError(`File exceeds maximum size of ${mb} MB`, 413);
  }

  if (typeof body.filename !== 'string' || !body.filename) {
    return jsonError('filename is required', 400);
  }
  const filename = sanitizeFilename(body.filename);
  if (!filename) return jsonError('Invalid filename', 400);

  let metadata: Record<string, string> | undefined;
  if (body.metadata && typeof body.metadata === 'object') {
    const check = validateMetadata(body.metadata);
    if (!check.ok) return jsonError(check.error, 400);
    metadata = body.metadata as Record<string, string>;
  }

  return { filename, contentType: body.contentType, metadata };
}

/** POST /media/presign — mints a new asset's first version. */
export async function handlePresignUpload(request: Request, env: Env, siteId: string): Promise<Response> {
  const parsed = await parsePresignRequest(request, env);
  if (parsed instanceof Response) return parsed;

  const assetId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const key = buildKey(siteId, assetId, versionId, parsed.filename);
  const { uploadUrl, expiresAt } = await createPresignedPutUrl(env, key, parsed.contentType);

  return new Response(
    JSON.stringify({ assetId, versionId, filename: parsed.filename, uploadUrl, expiresAt }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** POST /media/:assetId/versions/presign — mints a replacement version. */
export async function handlePresignVersion(
  request: Request,
  env: Env,
  siteId: string,
  assetId: string,
): Promise<Response> {
  const parsed = await parsePresignRequest(request, env);
  if (parsed instanceof Response) return parsed;

  try {
    await assertOwnedAsset(env, siteId, assetId);
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError('Not found', 404);
    throw err;
  }

  const versionId = crypto.randomUUID();
  const key = buildKey(siteId, assetId, versionId, parsed.filename);
  const { uploadUrl, expiresAt } = await createPresignedPutUrl(env, key, parsed.contentType);

  return new Response(
    JSON.stringify({ assetId, versionId, filename: parsed.filename, uploadUrl, expiresAt }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
