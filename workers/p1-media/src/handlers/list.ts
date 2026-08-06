import type { Env } from '../types';
import { listAssets } from '../store';

/** GET /media — site-scoped asset list with optional filename/alt search. */
export async function handleList(request: Request, env: Env, siteId: string): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('search') || undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const assets = await listAssets(env, siteId, {
    search,
    limit: limit && !isNaN(limit) ? limit : undefined,
  });

  return new Response(JSON.stringify(assets), {
    headers: { 'Content-Type': 'application/json' },
  });
}
