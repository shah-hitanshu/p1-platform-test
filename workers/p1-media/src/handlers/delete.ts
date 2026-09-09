import type { Env } from '../types';
import { softDeleteAsset, softDeleteChatAsset } from '../store';

/**
 * DELETE /media/:assetId — soft delete (bytes keep serving; hidden from the library).
 *
 * `DELETE /media/:assetId/chat` narrows it to an asset that is still a chat upload, which is
 * what clearing a conversation means. A promoted asset then 404s rather than being taken out
 * of the library.
 */
export async function handleDelete(
  env: Env,
  siteId: string,
  assetId: string,
  chatOnly = false,
): Promise<Response> {
  const deleted = chatOnly
    ? await softDeleteChatAsset(env, siteId, assetId)
    : await softDeleteAsset(env, siteId, assetId);
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
