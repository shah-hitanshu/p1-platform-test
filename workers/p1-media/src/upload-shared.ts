// Shared validation constants used by the presign/finalize handlers. The legacy
// multipart upload path (upload.ts/versions.ts) these were split out from has since
// been removed — the presign/finalize cutover is complete.

// SVG is excluded — it can contain <script> and executes on *.pantheon.io when served directly.
export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Closed set: an unrecognised value is a 400, not a default — a typo must not mint a
// library asset.
const ASSET_ORIGINS = ['library', 'chat'] as const;
export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

export function isAssetOrigin(value: unknown): value is AssetOrigin {
  return typeof value === 'string' && (ASSET_ORIGINS as readonly string[]).includes(value);
}

// A second set, not a widening: ALLOWED_MIME_TYPES stays "what the library will hold",
// which promote, MediaFigureBlock and the Images binding all depend on. text/html is
// stored raw and never served as html — see the /image/* gate and the content route.
const CHAT_MIME_TYPES = new Set([
  ...ALLOWED_MIME_TYPES,
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
]);

// Short deliberately: lengthening it later is harmless, shortening it deletes content
// people have come to rely on.
export const CHAT_RETENTION_DAYS = 30;

export function allowlistFor(origin: AssetOrigin): Set<string> {
  return origin === 'chat' ? CHAT_MIME_TYPES : ALLOWED_MIME_TYPES;
}

export function unsupportedTypeMessage(origin: AssetOrigin): string {
  return origin === 'chat'
    ? 'This file type is not accepted (images, or .txt/.md/.csv/.html text)'
    : 'Only image files are accepted (png, jpeg, gif, webp, avif)';
}

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
