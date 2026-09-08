/**
 * Cache tag taxonomy for /image/* responses. Lives next to the serve side so the tags
 * a response carries and the tags a purge targets cannot drift.
 *
 * Tags are the only purge mechanism that covers transform variants: one key's variants
 * are unbounded query-string permutations, so no URL list can enumerate them. The tag
 * format is load-bearing — changing it silently orphans every already-cached entry.
 */

export function siteTag(siteId: string): string {
  return `site:${siteId}`;
}

export function assetTag(assetId: string): string {
  return `asset:${assetId}`;
}

export function imageCacheTags(siteId: string, assetId: string): string[] {
  return [siteTag(siteId), assetTag(assetId)];
}

/**
 * Extracts the assetId from a canonical R2 key
 * (`{siteId}/assets/{assetId}/{versionId}-{filename}`), or null for a key that doesn't
 * match that shape — such a key gets no asset tag rather than a wrong one.
 */
export function assetIdFromKey(key: string): string | null {
  const parts = key.split('/');
  return parts.length >= 4 && parts[1] === 'assets' && parts[2] !== '' ? parts[2] : null;
}
