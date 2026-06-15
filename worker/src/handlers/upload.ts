import { Env } from '../types';

// SVG is excluded — it can contain <script> and executes on *.pantheon.io when served directly.
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
// R2 key limit is 1024 bytes; prefix is ~95 chars (two UUIDs + /media/ + timestamp).
const MAX_FILENAME_BYTES = 200;

function sizeErrorResponse(maxBytes: number): Response {
  const mb = Math.round(maxBytes / 1024 / 1024);
  return new Response(JSON.stringify({ error: `File exceeds maximum size of ${mb} MB` }), {
    status: 413,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleUpload(
  request: Request,
  env: Env,
  siteId: string,
  workstreamId: string,
  cdnBaseUrl: string,
): Promise<Response> {
  const maxBytes = parseInt(env.MAX_UPLOAD_BYTES ?? '', 10) || DEFAULT_MAX_UPLOAD_BYTES;

  // Fast gate: reject before buffering the body if Content-Length already exceeds the limit.
  // Content-Length is client-supplied so it can be absent or wrong — file.size below is authoritative.
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const declared = parseInt(contentLength, 10);
    if (!isNaN(declared) && declared > maxBytes) {
      return sizeErrorResponse(maxBytes);
    }
  }

  const formData = await request.formData();
  const rawEntry = formData.get('file');

  // Workers multipart file parts arrive as Blob (File extends Blob) — string means no file part
  if (!rawEntry || typeof rawEntry === 'string') {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = rawEntry as unknown as File;

  if (file.size === 0) {
    return new Response(JSON.stringify({ error: 'File is empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Authoritative size check against actual bytes received.
  if (file.size > maxBytes) {
    return sizeErrorResponse(maxBytes);
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return new Response(JSON.stringify({ error: 'Only image files are accepted (png, jpeg, gif, webp, avif)' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sanitize filename: replace non-alphanumeric (except dots and hyphens) with "-",
  // then collapse consecutive dots and strip leading/trailing dots.
  // Truncate to MAX_FILENAME_BYTES to prevent the composed R2 key from exceeding 1024 bytes.
  const sanitized = file.name
    .replace(/[^a-zA-Z0-9.\-]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_FILENAME_BYTES);
  const key = `${siteId}/${workstreamId}/media/${Date.now()}-${sanitized}`;

  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  });

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return new Response(
    JSON.stringify({
      key,
      url: `${cdnBaseUrl}/${encodedKey}`,
      filename: sanitized,
      size: file.size,
      contentType: file.type,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
