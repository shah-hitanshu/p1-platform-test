import type { Env } from '../types';
import { getStoredAsset } from '../store';
import { ALLOWED_MIME_TYPES, jsonError } from '../upload-shared';

// A transcript card is 72px; the cap leaves room for a retina card without turning this
// into a general-purpose transform endpoint, which /image/* already is.
const MAX_THUMBNAIL_WIDTH = 512;

function thumbnailWidth(raw: string | null): number | null {
  if (raw === null) return null;
  const width = Number.parseInt(raw, 10);
  if (!Number.isFinite(width) || width < 1) return null;
  return Math.min(width, MAX_THUMBNAIL_WIDTH);
}

/**
 * GET /media/:assetId/content — the bytes themselves. Unlike /image/* this is authenticated
 * and site-scoped, which is why it can serve text: the lookup uses the authenticated siteId,
 * so a cross-site read 404s (R0).
 *
 * `?width=` returns a resized image. The transcript's cards use it so they don't pull a
 * full-size original to paint a 72px square.
 */
export async function handleGetContent(env: Env, siteId: string, assetId: string, url: URL): Promise<Response> {
  const found = await getStoredAsset(env, siteId, assetId);
  if (!found) return jsonError('Not found', 404);
  const { asset, r2Key } = found;

  const object = await env.MEDIA_BUCKET.get(r2Key);
  if (!object) return jsonError('Not found', 404);

  const storedType = asset.contentType;
  const isImage = storedType !== undefined && ALLOWED_MIME_TYPES.has(storedType);
  const width = isImage ? thumbnailWidth(url.searchParams.get('width')) : null;

  if (width !== null) {
    try {
      const resized = await env.IMAGES.input(object.body)
        .transform({ width })
        .output({ format: 'image/webp' });
      return fileResponse(resized.image(), resized.contentType());
    } catch {
      // Local dev has a reduced Images binding, and a transform can also fail on a format it
      // won't decode. Serving the original costs bandwidth but still shows the image. The
      // body above is already consumed, so this needs a second read.
      const original = await env.MEDIA_BUCKET.get(r2Key);
      if (!original) return jsonError('Not found', 404);
      return fileResponse(original.body, storedType);
    }
  }

  // Anything that isn't a known image is served as plain text regardless of how it was
  // stored. A chat attachment can be .html, and echoing that type would let it execute on a
  // *.pantheon.io origin.
  return fileResponse(object.body, isImage ? storedType : 'text/plain; charset=utf-8');
}

function fileResponse(body: ReadableStream | null, contentType: string | undefined): Response {
  return new Response(body, {
    headers: {
      'Content-Type': contentType ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      // Per-user, not shared: the response is behind a bearer token.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
