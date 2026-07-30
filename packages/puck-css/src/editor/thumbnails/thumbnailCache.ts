/**
 * thumbnailCache
 *
 * In-memory, client-side cache for rendered component-preview HTML: a
 * module-level Map that survives editor/document remounts within a single
 * page load (Puck is force-remounted via `key` on every document switch,
 * which would otherwise re-render every preview from scratch).
 *
 * Deliberately NOT persisted to localStorage: the cached value is later
 * injected via `dangerouslySetInnerHTML` (see LiveThumbnail), and localStorage
 * is writable by any same-origin script. Persisting it would let a same-origin
 * write to a `p1-thumb:*` key plant markup that gets trusted and replayed on a
 * future load. Keeping the cache in-memory only means an attacker would need
 * live script execution in this exact session to influence it — at which
 * point they already have full DOM control and this cache buys them nothing.
 *
 * A preview depends only on component name + defaultProps, NOT on the document
 * being edited, so entries are reused across every page. The key embeds a hash
 * of the defaultProps plus a caller-supplied version so stale entries
 * invalidate when a component's inputs change.
 */

// Legacy prefix from a prior localStorage-backed version of this cache.
// clearThumbnailCache() still purges any stray entries left behind on a
// user's machine, but nothing here reads or writes through it anymore.
const LEGACY_LS_PREFIX = 'p1-thumb:';

// In-memory only, lives as long as the JS runtime (browser tab).
const memory = new Map<string, string>();

/** Small, dependency-free djb2 string hash. */
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** localStorage if available, else null (SSR / disabled / private mode). */
function getStore(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

/**
 * Build a cache key for a component preview. Changing `defaultProps` or
 * `version` yields a different key, so cached previews invalidate.
 */
export function makeThumbnailKey(name: string, defaultProps: unknown, version = '2'): string {
  let serialized = '';
  try {
    serialized = JSON.stringify(defaultProps) ?? '';
  } catch {
    // Non-serializable props — fall back to name+version only.
    serialized = '';
  }
  return `${name}:${hashString(`${version}|${serialized}`)}`;
}

/** A component's defaultProps, resolved from its config entry. */
function defaultPropsFor(
  config: { components?: Record<string, { defaultProps?: unknown }> } | undefined,
  name: string,
): unknown {
  return config?.components?.[name]?.defaultProps ?? {};
}

/** Cache key for a component preview, shared by LiveThumbnail and ThumbnailCard. */
export function getThumbnailCacheKey(
  config: { components?: Record<string, { defaultProps?: unknown }> } | undefined,
  name: string,
  version?: string,
): string {
  return makeThumbnailKey(name, defaultPropsFor(config, name), version);
}

/** Read a cached preview (in-memory only — see file header for why). */
export function getCachedThumbnail(key: string): string | undefined {
  return memory.get(key);
}

/** Write a preview to the in-memory cache. */
export function setCachedThumbnail(key: string, html: string): void {
  memory.set(key, html);
}

/** Clear the in-memory cache, plus any stray entries left by an older, localStorage-backed version of this cache. */
export function clearThumbnailCache(): void {
  memory.clear();

  const store = getStore();
  if (store) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(LEGACY_LS_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => store.removeItem(k));
    } catch {
      // ignore
    }
  }
}
