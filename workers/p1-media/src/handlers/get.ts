import type { Env } from '../types';
import { getAsset } from '../store';

/** GET /media/:assetId — single asset scoped to its owning site (R0 via store). */
export async function handleGetAsset(env: Env, siteId: string, assetId: string): Promise<Response> {
  const asset = await getAsset(env, siteId, assetId);
  if (!asset) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(asset), {
    headers: { 'Content-Type': 'application/json' },
  });
}
