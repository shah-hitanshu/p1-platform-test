/**
 * Cache contract shared by the content delivery routes, which tag responses,
 * and the publish path, which purges those tags. If the two sides disagree on
 * tag shape a publish leaves stale content at the edge with no visible error.
 */

export const NOT_FOUND_CACHE_TTL_SECONDS = 60;

/**
 * Upper bound on how long a miss may be remembered. A dead path costs three
 * serialized Postgres queries per lookup, but a real page that 404s before it
 * is published stays invisible for the whole TTL.
 */
export const MAX_NOT_FOUND_CACHE_TTL_SECONDS = 300;

export interface ContentCacheTagParams {
  siteId: string;
  branchId?: string;
  documentId?: string;
}

export function contentCacheTags(params: ContentCacheTagParams): string[] {
  const tags = [`site:${params.siteId}`];
  if (params.branchId !== undefined && params.branchId !== '') {
    tags.push(`branch:${params.branchId}`);
  }
  if (params.documentId !== undefined && params.documentId !== '') {
    tags.push(`doc:${params.documentId}`);
  }
  return tags;
}

export function notFoundCacheControl(
  ttlSeconds: number = NOT_FOUND_CACHE_TTL_SECONDS,
): string {
  const bounded = Math.min(ttlSeconds, MAX_NOT_FOUND_CACHE_TTL_SECONDS);
  return `public, s-maxage=${String(bounded)}`;
}

