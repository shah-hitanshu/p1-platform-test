import { Env } from '../types';

export async function handleUpload(
  request: Request,
  env: Env,
  siteId: string,
  workerUrl: string,
): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sanitize filename: replace non-alphanumeric (except dots and hyphens) with "-"
  const sanitized = file.name.replace(/[^a-zA-Z0-9.\-]/g, '-');
  const key = `${siteId}/media/${Date.now()}-${sanitized}`;

  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  });

  return new Response(
    JSON.stringify({
      key,
      url: `${workerUrl}/image/${key}`,
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
