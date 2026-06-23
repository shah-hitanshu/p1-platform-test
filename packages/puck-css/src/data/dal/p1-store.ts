/**
 * P1-backed PageStore — per-operation API calls.
 *
 * Each read/write/delete makes a real API call to the P1 backend.
 * No data is cached in memory — the backend is the source of truth.
 */

import type { PageStore } from "./types";
import { getRequestAuthToken } from "./request-auth";

/**
 * Minimal subset of P1Client used by the store.
 * Declared here so consumers don't require a hard dependency on
 * @pantheon-systems/css-client — they pass in their own client instance.
 */
export interface P1StoreClient {
  documents: {
    list(siteId: string, branchId: string): Promise<{ id: string; path: string }[]>;
    getByPath(siteId: string, path: string): Promise<{ id: string; path: string }>;
    create(params: { siteId: string; branchId: string; path: string }): Promise<{ id: string; path: string }>;
    delete(siteId: string, branchId: string, documentId: string): Promise<void>;
  };
  versions: {
    getLatest(siteId: string, branchId: string, documentId: string): Promise<{ snapshot: Record<string, unknown> }>;
    create(siteId: string, params: { documentId: string; branchId: string; snapshot: Record<string, unknown> }): Promise<unknown>;
  };
}

/** Minimal subset of P1ContentClient used for published-only reads. */
export interface P1ContentClientInterface {
  getPage(path: string): Promise<{ data: Record<string, unknown> } | null>;
}

export interface P1StoreConfig {
  client: P1StoreClient;
  /**
   * When provided, public reads (no auth token in context) use this client
   * which hits the content delivery endpoint and returns only published versions.
   * Editor reads (auth token present) always use the versions API.
   */
  contentClient?: P1ContentClientInterface;
  siteId: string;
  /**
   * Branch ID for authoring operations. When omitted, resolved lazily on the
   * first editor request via resolveBranchId. Not required for public reads —
   * those use contentClient which defaults to the main branch server-side.
   */
  branchId?: string;
  /**
   * Called on the first editor operation when branchId is not pre-configured.
   * Receives the bearer token from the active request context so branch
   * detection runs under the user's credentials, not the sat_ API key.
   */
  resolveBranchId?: (bearerToken: string) => Promise<string>;
  /** Factory to create a client with a specific bearer token (for user-auth writes). */
  createAuthClient?: (bearerToken: string) => P1StoreClient;
}

/**
 * Creates an async PageStore backed by a P1 API client.
 *
 * get/set/delete/has hit the API directly per call.
 * keys() is cached with a short TTL and retried on failure.
 */
function toDocPath(path: string): string {
  if (path === "/") return "/";
  return path.startsWith("/") ? path.slice(1) : path;
}

function toStorePath(docPath: string): string {
  return docPath.startsWith("/") ? docPath : "/" + docPath;
}

const KEYS_CACHE_TTL_MS = 30_000;
const KEYS_MAX_RETRIES = 3;
const KEYS_RETRY_DELAY_MS = 500;

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export function createP1PageStore(config: P1StoreConfig): PageStore {
  const { client, contentClient, siteId, createAuthClient } = config;

  let _keysCache: { promise: Promise<string[]>; ts: number } | null = null;
  let _resolvedBranchIdPromise: Promise<string> | null = null;

  // Returns the branch ID, resolving it lazily on the first editor request when
  // not pre-configured. Resolution uses the request's bearer token so it never
  // requires sat_ token access to the branches endpoint.
  function getBranchId(): Promise<string> {
    if (config.branchId) return Promise.resolve(config.branchId);
    if (!_resolvedBranchIdPromise) {
      const token = getRequestAuthToken();
      if (!token || !config.resolveBranchId) {
        return Promise.reject(
          new Error(
            "Branch ID required for editor operations: set p1BranchId in config or use an authenticated request.",
          ),
        );
      }
      _resolvedBranchIdPromise = config.resolveBranchId(token).catch((err: unknown) => {
        _resolvedBranchIdPromise = null;
        throw err;
      });
    }
    return _resolvedBranchIdPromise;
  }

  function writeClient(): P1StoreClient {
    const token = getRequestAuthToken();
    if (token && createAuthClient) {
      return createAuthClient(token);
    }
    return client;
  }

  function invalidateKeysCache(): void {
    _keysCache = null;
  }

  return {
    async get(path: string): Promise<unknown | undefined> {
      // Public rendering: no auth token in context — use content client which
      // returns only published versions via the content delivery endpoint.
      if (contentClient && !getRequestAuthToken()) {
        try {
          const result = await contentClient.getPage(toDocPath(path));
          return result?.data ?? undefined;
        } catch (err) {
          console.info("[css-store] get(%s) failed:", path, (err as Error).message);
          return undefined;
        }
      }
      // Editor context (auth token present) or no content client: return latest version.
      try {
        const branchId = await getBranchId();
        const doc = await client.documents.getByPath(siteId, toDocPath(path));
        const version = await client.versions.getLatest(siteId, branchId, doc.id);
        return version.snapshot;
      } catch (err) {
        console.info("[css-store] get(%s) failed:", path, (err as Error).message);
        return undefined;
      }
    },

    async set(path: string, value: unknown): Promise<void> {
      const wc = writeClient();
      const dp = toDocPath(path);
      const branchId = await getBranchId();
      let docId: string;
      try {
        const existing = await client.documents.getByPath(siteId, dp);
        docId = existing.id;
      } catch {
        const created = await wc.documents.create({ siteId, branchId, path: dp });
        docId = created.id;
      }
      await wc.versions.create(siteId, {
        documentId: docId,
        branchId,
        snapshot: value as Record<string, unknown>,
      });
      invalidateKeysCache();
    },

    async delete(path: string): Promise<void> {
      try {
        const branchId = await getBranchId();
        const doc = await client.documents.getByPath(siteId, toDocPath(path));
        await writeClient().documents.delete(siteId, branchId, doc.id);
      } catch (err) {
        console.info("[css-store] delete(%s) — not found or failed:", path, (err as Error).message);
      }
      invalidateKeysCache();
    },

    async has(path: string): Promise<boolean> {
      try {
        await client.documents.getByPath(siteId, toDocPath(path));
        return true;
      } catch (err) {
        console.info("[css-store] has(%s) — not found or failed:", path, (err as Error).message);
        return false;
      }
    },

    async keys(): Promise<string[]> {
      const now = Date.now();
      if (_keysCache && now - _keysCache.ts < KEYS_CACHE_TTL_MS) {
        return _keysCache.promise;
      }
      const promise = getBranchId()
        .then((branchId) => withRetry(
          () => client.documents.list(siteId, branchId),
          KEYS_MAX_RETRIES,
          KEYS_RETRY_DELAY_MS,
        ))
        .then((docs) => docs.map((d) => toStorePath(d.path)))
        .catch((err) => {
          console.error("[css-store] keys() failed:", (err as Error).message);
          invalidateKeysCache();
          return [] as string[];
        });
      _keysCache = { promise, ts: now };
      return promise;
    },
  };
}
