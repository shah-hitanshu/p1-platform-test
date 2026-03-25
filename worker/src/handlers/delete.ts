import { Env } from '../types';

export async function handleDelete(
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

  await env.MEDIA_BUCKET.delete(key);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
