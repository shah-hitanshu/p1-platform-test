import type { Env } from '../types';
import { assetIdFromKey, imageCacheTags } from '../cache/image-cache';

const VALID_FIT = new Set(['scale-down', 'contain', 'pad', 'squeeze', 'cover', 'crop', 'aspect-crop']);
const VALID_GRAVITY_NAMED = new Set(['face', 'left', 'right', 'top', 'bottom', 'center', 'auto', 'entropy']);
const VALID_ROTATE = new Set([0, 90, 180, 270]);
const TRANSFORM_PARAMS = [
  'width', 'height', 'format', 'quality', 'fit', 'gravity',
  'blur', 'brightness', 'contrast', 'saturation', 'sharpen', 'rotate',
  'trim.top', 'trim.left', 'trim.height', 'trim.width',
];

// Maps URL ?format= values to MIME types required by ImageOutputOptions.
const FORMAT_MIME: Record<string, ImageOutputOptions['format']> = {
  jpeg: 'image/jpeg',
  jpg:  'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

function resolveFormat(
  accept: string | null,
  requested: string | null,
): ImageOutputOptions['format'] {
  if (requested && requested !== 'auto') {
    return FORMAT_MIME[requested.toLowerCase()] ?? 'image/jpeg';
  }
  if (accept?.includes('image/avif')) return 'image/avif';
  if (accept?.includes('image/webp')) return 'image/webp';
  return 'image/jpeg';
}

function num(val: string | null): number | undefined {
  if (val === null) return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

// R9: bound transform params so an unauthenticated caller can't drive unbounded
// compute/billing with absurd values. (Rate limiting on /image/* is a separate,
// deferred mitigation.)
const MAX_DIMENSION = 5000;
function clampNum(
  val: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (val === undefined) return undefined;
  return Math.min(Math.max(val, min), max);
}

function parseGravity(val: string | null): ImageTransform['gravity'] | undefined {
  if (!val) return undefined;
  if (VALID_GRAVITY_NAMED.has(val)) return val as 'face' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'auto' | 'entropy';
  // XxY relative coordinates e.g. "0.3x0.7"
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(val);
  if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]), mode: 'remainder' as const };
  return undefined;
}

function buildTransform(p: URLSearchParams): ImageTransform {
  const fitRaw = p.get('fit');

  const trimTop    = num(p.get('trim.top'));
  const trimLeft   = num(p.get('trim.left'));
  const trimHeight = num(p.get('trim.height'));
  const trimWidth  = num(p.get('trim.width'));
  const hasTrim    = [trimTop, trimLeft, trimHeight, trimWidth].some(v => v !== undefined);

  const rotateRaw = num(p.get('rotate'));

  return {
    width:      clampNum(num(p.get('width')), 1, MAX_DIMENSION),
    height:     clampNum(num(p.get('height')), 1, MAX_DIMENSION),
    fit:        fitRaw && VALID_FIT.has(fitRaw) ? fitRaw as ImageTransform['fit'] : undefined,
    gravity:    parseGravity(p.get('gravity')),
    blur:       clampNum(num(p.get('blur')), 0, 250),
    brightness: clampNum(num(p.get('brightness')), 0, 10),
    contrast:   clampNum(num(p.get('contrast')), 0, 10),
    saturation: clampNum(num(p.get('saturation')), 0, 10),
    sharpen:    clampNum(num(p.get('sharpen')), 0, 10),
    rotate:     rotateRaw !== undefined && VALID_ROTATE.has(rotateRaw)
                  ? rotateRaw as 0 | 90 | 180 | 270
                  : undefined,
    trim: hasTrim ? { top: trimTop, left: trimLeft, height: trimHeight, width: trimWidth } : undefined,
  };
}

function needsTransform(p: URLSearchParams): boolean {
  return TRANSFORM_PARAMS.some(k => p.has(k));
}

const MIME_TO_FORMAT_PARAM: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Splits an /image/* pathname into siteId + full R2 key, or null when malformed. */
export function parseImagePath(path: string): { siteId: string; key: string } | null {
  if (!path.startsWith('/image/')) return null;
  const key = decodeURIComponent(path.slice('/image/'.length));
  const slashIndex = key.indexOf('/');
  if (slashIndex === -1) return null;
  return { siteId: key.slice(0, slashIndex), key };
}

/**
 * The URL a request is cached under. The Workers Caching key is the forwarded URL and
 * excludes headers, so a format that would be negotiated from `Accept` must be resolved
 * INTO the URL before forwarding — otherwise one client's avif would be cached under
 * the bare URL and served to clients that never accepted avif.
 */
export function cacheKeyImageUrl(request: Request): string {
  const url = new URL(request.url);
  const params = url.searchParams;
  if (needsTransform(params)) {
    const requested = params.get('format');
    if (!requested || requested === 'auto') {
      const mime = resolveFormat(request.headers.get('Accept'), requested);
      url.searchParams.set('format', MIME_TO_FORMAT_PARAM[mime] ?? 'jpeg');
    }
  }
  return url.toString();
}

export async function handleImage(
  request: Request,
  env: Env,
  siteId: string,
  key: string,
): Promise<Response> {
  // Prevent path traversal — key must belong to the requested site.
  // Error responses carry no-store: 403/404 are heuristically cacheable statuses, and
  // this handler now runs behind Workers Caching (entrypoints/cached-image.ts) — a
  // cached pre-upload 404 would mask the asset after finalize.
  if (!key.startsWith(`${siteId}/`)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const shouldTransform = needsTransform(params);

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const responseHeaders = new Headers();
  responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  // Purge hook: tags are what a takedown purges by, since transform variants cannot be
  // enumerated as URLs. Keys that predate the canonical shape get no asset tag.
  const assetId = assetIdFromKey(key);
  if (assetId !== null) {
    responseHeaders.set('Cache-Tag', imageCacheTags(siteId, assetId).join(','));
  }

  let response: Response;

  if (shouldTransform) {
    const format = resolveFormat(request.headers.get('Accept'), params.get('format'));
    const quality = clampNum(num(params.get('quality')), 1, 100);
    const transform = buildTransform(params);

    // Uses Cloudflare Images binding (account-based, Workers-only accounts).
    // When P1 zones are provisioned, migrate to cf.image (zone-level transforms)
    // for CDN-edge execution and built-in tiered caching. Migration scope: this
    // file only — the binding call below is the only site-specific code.
    const result = await env.IMAGES
      .input(object.body)
      .transform(transform)
      .output({ format, quality });

    responseHeaders.set('Content-Type', result.contentType());
    response = new Response(result.image(), { headers: responseHeaders });
  } else {
    // No transform params — serve raw to avoid unnecessary billing
    responseHeaders.set(
      'Content-Type',
      object.httpMetadata?.contentType || 'application/octet-stream',
    );
    response = new Response(object.body, { headers: responseHeaders });
  }

  return response;
}
