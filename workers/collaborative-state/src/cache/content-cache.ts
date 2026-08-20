/**
 * Cache contract shared by the content delivery routes, which tag responses,
 * and the publish path, which purges those tags. If the two sides disagree on
 * tag shape a publish leaves stale content at the edge with no visible error.
 *
 * Tag taxonomy [PCC-3709]:
 * - site:<siteId>    — on every response; the bulk umbrella (site import,
 *                      break-glass) and, until miss:<siteId>:<path> tags land,
 *                      the only tag that reaches cached 404s, so reveal-class
 *                      events (publish, merge, document restore) still purge it.
 * - branch:<branchId> — on branch-scoped responses.
 * - doc:<documentId> — on document responses; branch-agnostic, so one tag
 *                      evicts that document's cached responses on every branch,
 *                      COW-inherited previews included.
 * - list:<siteId>    — on content-pages listing responses; one tag covers all
 *                      branches' listings, avoiding per-branch enumeration.
 *
 * All tags must respect the Workers Cache limits (verified 2026-08-19 against
 * developers.cloudflare.com/workers/cache): printable ASCII, ≤1024 chars per
 * tag, ≤1000 tags per response, case-insensitive matching. UUIDs are safely
 * within all of these.
 */

export const NOT_FOUND_CACHE_TTL_SECONDS = 60;

/**
 * Upper bound on how long a miss may be remembered. A dead path costs three
 * serialized Postgres queries per lookup, but a real page that 404s before it
 * is published stays invisible for the whole TTL.
 */
export const MAX_NOT_FOUND_CACHE_TTL_SECONDS = 300;

export function siteTag(siteId: string): string {
  return `site:${siteId}`;
}

export function branchTag(branchId: string): string {
  return `branch:${branchId}`;
}

export function docTag(documentId: string): string {
  return `doc:${documentId}`;
}

export function listTag(siteId: string): string {
  return `list:${siteId}`;
}

export interface ContentCacheTagParams {
  siteId: string;
  branchId?: string;
  documentId?: string;
}

export function contentCacheTags(params: ContentCacheTagParams): string[] {
  const tags = [siteTag(params.siteId)];
  if (params.branchId !== undefined && params.branchId !== '') {
    tags.push(branchTag(params.branchId));
  }
  if (params.documentId !== undefined && params.documentId !== '') {
    tags.push(docTag(params.documentId));
  }
  return tags;
}

/**
 * Tags for the content-pages listing response. The listing deliberately
 * carries no doc tag — any publish or delete changes the list, so no single
 * document's tag could invalidate it. list:<siteId> is its dedicated
 * invalidation handle instead.
 */
export function listingCacheTags(params: { siteId: string; branchId: string }): string[] {
  return [...contentCacheTags(params), listTag(params.siteId)];
}

export function notFoundCacheControl(
  ttlSeconds: number = NOT_FOUND_CACHE_TTL_SECONDS,
): string {
  const bounded = Math.min(ttlSeconds, MAX_NOT_FOUND_CACHE_TTL_SECONDS);
  return `public, s-maxage=${String(bounded)}`;
}
