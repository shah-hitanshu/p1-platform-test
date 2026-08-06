import type { Env } from '../types';
import { validateMetadata } from '../schema';
import { sanitizeFilename, buildKey, finalizeAssetCreation, finalizeVersionAdd, NotFoundError } from '../store';
import { DEFAULT_MAX_UPLOAD_BYTES, jsonError } from '../upload-shared';

// Image format headers (dimensions) live in the first few KB for every format in the
// allowlist (PNG/JPEG/GIF/WebP/AVIF) — a ranged read avoids re-pulling the whole object
// through the Worker, which would silently reintroduce the egress cost this migration
// exists to remove.
const DIMENSION_PROBE_BYTES = 65536;

interface FinalizeRequestBody {
  assetId?: unknown;
  versionId?: unknown;
  filename?: unknown;
  metadata?: Record<string, unknown>;
}

interface ParsedFinalizeRequest {
  // Only present/required for the new-asset path (POST /media/finalize) — the
  // versions path gets its assetId from the URL, not the body.
  assetId?: string;
  versionId: string;
  filename: string;
  metadata?: Record<string, string>;
}

async function parseFinalizeRequest(request: Request): Promise<Response | ParsedFinalizeRequest> {
  let body: FinalizeRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (typeof body.versionId !== 'string' || !body.versionId) return jsonError('versionId is required', 400);
  if (typeof body.filename !== 'string' || !body.filename) return jsonError('filename is required', 400);

  // Re-sanitize defensively — idempotent if the client echoes back what presign
  // returned. If it doesn't match what's actually in R2, the key this handler
  // reconstructs won't match the uploaded object's key, and head() below will 404.
  const filename = sanitizeFilename(body.filename);
  if (!filename) return jsonError('Invalid filename', 400);

  let metadata: Record<string, string> | undefined;
  if (body.metadata && typeof body.metadata === 'object') {
    const check = validateMetadata(body.metadata);
    if (!check.ok) return jsonError(check.error, 400);
    metadata = body.metadata as Record<string, string>;
  }

  const assetId = typeof body.assetId === 'string' && body.assetId ? body.assetId : undefined;
  return { assetId, versionId: body.versionId, filename, metadata };
}

/**
 * Captures width/height for an already-uploaded R2 object via a ranged read, never
 * fatal (mirrors the best-effort posture of the legacy multipart path). Explicitly
 * drains the returned stream after use to avoid a dangling-body warning.
 */
async function captureDimensions(
  env: Env,
  key: string,
): Promise<{ width?: number; height?: number }> {
  try {
    const probe = await env.MEDIA_BUCKET.get(key, { range: { length: DIMENSION_PROBE_BYTES } });
    if (!probe) return {};
    try {
      const info = await env.IMAGES.info(probe.body);
      if ('width' in info && 'height' in info) {
        return { width: info.width, height: info.height };
      }
      return {};
    } finally {
      // Real R2 bodies are ReadableStreams and must be drained/cancelled to avoid a
      // dangling-body warning; test doubles may return a plain value with no cancel().
      const cancel = (probe.body as unknown as { cancel?: () => Promise<void> }).cancel;
      if (typeof cancel === 'function') await cancel.call(probe.body).catch(() => {});
    }
  } catch {
    // Images binding unavailable, input not decodable, or range unsupported by the
    // test double — store without dimensions rather than fail the finalize.
    return {};
  }
}

interface ConfirmedObject {
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

/**
 * Confirms a presigned upload actually landed at `key`, enforces the real size cap
 * (deleting an oversized object rather than persisting anything about it), and
 * captures dimensions — the shared middle of both finalize endpoints. Returns a
 * Response directly for the two failure cases (404/413) so callers can just early-return.
 */
async function confirmUploadedObject(env: Env, key: string): Promise<Response | ConfirmedObject> {
  const head = await env.MEDIA_BUCKET.head(key);
  if (!head) {
    return jsonError('Upload not found — the presigned URL may have expired, or the PUT never completed', 404);
  }

  const maxBytes = parseInt(env.MAX_UPLOAD_BYTES ?? '', 10) || DEFAULT_MAX_UPLOAD_BYTES;
  if (head.size > maxBytes) {
    await env.MEDIA_BUCKET.delete(key);
    const mb = Math.round(maxBytes / 1024 / 1024);
    return jsonError(`File exceeds maximum size of ${mb} MB`, 413);
  }

  const { width, height } = await captureDimensions(env, key);
  return {
    contentType: head.httpMetadata?.contentType || 'application/octet-stream',
    size: head.size,
    width,
    height,
  };
}

/** POST /media/finalize — confirms a presigned upload landed and writes the D1 rows. */
export async function handleFinalizeUpload(request: Request, env: Env, siteId: string): Promise<Response> {
  const parsed = await parseFinalizeRequest(request);
  if (parsed instanceof Response) return parsed;
  if (!parsed.assetId) return jsonError('assetId is required', 400);

  const key = buildKey(siteId, parsed.assetId, parsed.versionId, parsed.filename);
  const confirmed = await confirmUploadedObject(env, key);
  if (confirmed instanceof Response) return confirmed;

  const asset = await finalizeAssetCreation(env, {
    siteId,
    assetId: parsed.assetId,
    versionId: parsed.versionId,
    filename: parsed.filename,
    ...confirmed,
    metadata: parsed.metadata,
  });

  return new Response(JSON.stringify(asset), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** POST /media/:assetId/versions/finalize — confirms a presigned replacement version landed. */
export async function handleFinalizeVersion(
  request: Request,
  env: Env,
  siteId: string,
  assetId: string,
): Promise<Response> {
  const parsed = await parseFinalizeRequest(request);
  if (parsed instanceof Response) return parsed;

  const key = buildKey(siteId, assetId, parsed.versionId, parsed.filename);
  const confirmed = await confirmUploadedObject(env, key);
  if (confirmed instanceof Response) return confirmed;

  try {
    const asset = await finalizeVersionAdd(env, {
      siteId,
      assetId,
      versionId: parsed.versionId,
      filename: parsed.filename,
      ...confirmed,
    });
    return new Response(JSON.stringify(asset), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError('Not found', 404);
    throw err;
  }
}
