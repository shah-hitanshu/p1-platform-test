import { Env } from '../types';

export async function handleImage(
  request: Request,
  env: Env,
  siteId: string,
  key: string,
): Promise<Response> {
  // Prevent path traversal — key must belong to the requested site
  if (!key.startsWith(`${siteId}/`)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const object = await env.MEDIA_BUCKET.get(key);

  if (!object) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers();
  headers.set(
    'Content-Type',
    object.httpMetadata?.contentType || 'application/octet-stream',
  );
  headers.set(
    'Cache-Control',
    'public, max-age=31536000, immutable',
  );

  return new Response(object.body, { headers });
}
