import type { Env } from '../types';
import { validateMetadata } from '../schema';
import { updateAssetMetadata } from '../store';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** PATCH /media/:assetId — update metadata defaults (flat map; null clears a field). */
export async function handlePatch(
  request: Request,
  env: Env,
  siteId: string,
  assetId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError('Body must be a JSON object of metadata fields', 400);
  }

  const patch = body as Record<string, unknown>;

  // Validate non-null values against the schema + caps (R6/R13). Nulls (clears) are allowed.
  const nonNull: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null) nonNull[k] = v;
  }
  const check = validateMetadata(nonNull);
  if (!check.ok) return jsonError(check.error, 400);

  const asset = await updateAssetMetadata(env, siteId, assetId, patch as Record<string, string | null>);
  if (!asset) return jsonError('Not found', 404);

  return new Response(JSON.stringify(asset), {
    headers: { 'Content-Type': 'application/json' },
  });
}
