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

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
