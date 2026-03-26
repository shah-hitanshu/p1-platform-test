import { Env, MediaItem } from '../types';

export async function handleList(
  request: Request,
  env: Env,
  siteId: string,
  workerUrl: string,
): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.toLowerCase();

  const prefix = `${siteId}/media/`;
  const items: MediaItem[] = [];

  let cursor: string | undefined;
  do {
    const listed = await env.MEDIA_BUCKET.list({ prefix, cursor });
    cursor = listed.truncated ? listed.cursor : undefined;

    for (const object of listed.objects) {
      // Strip "{siteId}/media/{timestamp}-" prefix to get the original filename
      const afterPrefix = object.key.slice(prefix.length);
      const dashIndex = afterPrefix.indexOf('-');
      const filename = dashIndex !== -1 ? afterPrefix.slice(dashIndex + 1) : afterPrefix;

      // Apply search filter if provided
      if (search && !filename.toLowerCase().includes(search)) {
        continue;
      }

      const encodedKey = object.key.split('/').map(encodeURIComponent).join('/');
      items.push({
        key: object.key,
        url: `${workerUrl}/image/${encodedKey}`,
        filename,
        size: object.size,
        lastModified: object.uploaded?.toISOString(),
      });
    }
  } while (cursor);

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
}
