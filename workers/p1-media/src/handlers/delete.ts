import { Env } from '../types';
import { softDeleteAsset } from '../store';

/** DELETE /media/:assetId — soft delete (bytes keep serving; hidden from the library). */
export async function handleDelete(env: Env, siteId: string, assetId: string): Promise<Response> {
  const deleted = await softDeleteAsset(env, siteId, assetId);
  if (!deleted) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
