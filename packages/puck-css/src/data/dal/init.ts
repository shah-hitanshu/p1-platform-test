/**
 * SDK-internal data layer initialization.
 *
 * Called lazily by createP1Handler / createP1Pages on the first
 * request. Deduplicates so the init runs at most once regardless
 * of how many entry points import it.
 */

import { PRODUCTION_BASE_URL } from "../../core/config.js";
import type { PageStore, EditorMetaStore, RemoteDatasourceDefStore } from "./types";
import { createP1PageStore, type P1StoreClient, type P1ContentClientInterface } from "./p1-store";
import { initializeStores } from "./index";

export interface P1DataConfig {
  /** Base URL of the API. */
  p1BaseUrl?: string;

  /** API key for the backend. */
  p1ApiKey?: string;

  /** Site ID in the backend. */
  p1SiteId?: string;

  /**
   * Branch ID. When omitted the SDK auto-detects the main branch.
   */
  p1BranchId?: string;
}

let _initPromise: Promise<void> | null = null;

let _sharedClient: P1StoreClient | null = null;
let _sharedSiteId: string | null = null;
let _sharedBranchId: string | null = null;
let _sharedCreateAuthClient: ((bearerToken: string) => P1StoreClient) | null = null;

/**
 * Ensures data stores are initialized. Safe to call from multiple
 * entry points — runs only once and subsequent calls return the
 * same resolved promise.
 */
export function ensureInitialized(dataConfig: P1DataConfig): Promise<void> {
  if (!_initPromise) {
    _initPromise = doInit(dataConfig).catch((err) => {
      console.error("[puck-css] initialization failed:", (err as Error).message);
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

async function doInit(cfg: P1DataConfig): Promise<void> {
  const { p1SiteId } = cfg;
  // Same fallback as createNextConfig/createNextContentClient (PCC-3282):
  // an unset p1BaseUrl (no CSS_BASE_URL / NEXT_PUBLIC_CSS_BASE_URL) should
  // resolve to the production backend rather than leaving init — and every
  // login/render request that awaits it — broken.
  const p1BaseUrl = cfg.p1BaseUrl ?? PRODUCTION_BASE_URL;

  if (!p1SiteId) {
    throw new Error(
      "Missing required config: p1SiteId must be set.",
    );
  }

  // Dynamic import so @pantheon-systems/css-client is only loaded when needed.
  const p1ClientModule = await import("@pantheon-systems/css-client");
  const P1ClientCtor = p1ClientModule.P1Client as new (opts: { baseUrl: string; apiKey?: string; authProvider?: () => Promise<string> }) => P1StoreClient & { branches: { list(siteId: string): Promise<{ id: string; isMain: boolean }[]> } };
  const P1ContentClientCtor = p1ClientModule.P1ContentClient as new (opts: { baseUrl: string; apiToken: string; siteId: string; branchId?: string }) => P1ContentClientInterface;

  const client = new P1ClientCtor({
    baseUrl: p1BaseUrl,
    apiKey: cfg.p1ApiKey,
  });

  // Content client for published-only reads on public pages.
  // No branchId: the content delivery API defaults to main, and passing
  // ?branch= would cause a 403 for read:published tokens (mainBranchOnly enforcement).
  const contentClient = new P1ContentClientCtor({
    baseUrl: p1BaseUrl,
    apiToken: cfg.p1ApiKey ?? "",
    siteId: p1SiteId,
  });

  const createAuthClient = (bearerToken: string) => {
    return new P1ClientCtor({
      baseUrl: p1BaseUrl,
      authProvider: async () => `Bearer ${bearerToken}`,
    }) as unknown as P1StoreClient;
  };

  _sharedClient = client as unknown as P1StoreClient;
  _sharedSiteId = p1SiteId;
  _sharedBranchId = cfg.p1BranchId ?? null;
  _sharedCreateAuthClient = createAuthClient;

  const pageStore = createP1PageStore({
    client,
    contentClient,
    siteId: p1SiteId,
    branchId: cfg.p1BranchId,
    // Branch auto-detection deferred to the first editor request so it runs
    // under the user's bearer token. A read:published sat_ token cannot reach
    // the branches endpoint, so detection must not happen at init time.
    resolveBranchId: async (bearerToken: string) => {
      const authClient = new P1ClientCtor({
        baseUrl: p1BaseUrl,
        authProvider: async () => `Bearer ${bearerToken}`,
      });
      const branches = await authClient.branches.list(p1SiteId);
      const main = branches.find((b: { isMain: boolean }) => b.isMain);
      if (!main) throw new Error("No main branch found for site " + p1SiteId);
      _sharedBranchId = main.id;
      return main.id;
    },
    createAuthClient: (bearerToken: string) => {
      return new P1ClientCtor({
        baseUrl: p1BaseUrl,
        authProvider: async () => `Bearer ${bearerToken}`,
      }) as unknown as P1StoreClient;
    },
  });

  // In-memory stores for editor metadata and remote datasource definitions.
  // These don't have P1-backed implementations yet — the in-memory defaults
  // are sufficient for server-side rendering (SSR) and the editor persists
  // its own state client-side.
  const editorMetaData = new Map<string, Record<string, unknown>>();
  const editorMetaStore: EditorMetaStore = {
    get: (path) => editorMetaData.get(path),
    set: (path, row) => { editorMetaData.set(path, row); },
    delete: (path) => { editorMetaData.delete(path); },
  };

  let datasourceDefs: unknown[] = [];
  const remoteDatasourceDefStore: RemoteDatasourceDefStore = {
    list: () => datasourceDefs,
    save: (defs) => { datasourceDefs = defs; },
  };

  initializeStores({ pageStore, editorMetaStore, remoteDatasourceDefStore });
}

/**
 * Creates a PageStore scoped to a specific branch, reusing the
 * shared P1Client and siteId from the initial ensureInitialized() call.
 * Useful for the structure page to read/write routes on non-default branches.
 */
export function createPageStoreForBranch(branchId: string): PageStore {
  if (!_sharedClient || !_sharedSiteId) {
    throw new Error("Stores not initialized. Call ensureInitialized() first.");
  }
  return createP1PageStore({
    client: _sharedClient,
    siteId: _sharedSiteId,
    branchId,
    createAuthClient: _sharedCreateAuthClient ?? undefined,
    authenticatedReads: true,
  });
}

export function getSharedP1Client(): P1StoreClient | null {
  return _sharedClient;
}

export function getSharedSiteId(): string | null {
  return _sharedSiteId;
}

// Returns the branch ID configured via p1BranchId, or auto-detected on
// first editor request by resolveBranchId. Query fetchers and
// editor-context use this to target the active branch.
export function getSharedBranchId(): string | null {
  return _sharedBranchId;
}

export function createAuthenticatedClient(bearerToken: string): P1StoreClient | null {
  if (!_sharedCreateAuthClient) return null;
  return _sharedCreateAuthClient(bearerToken);
}

/** Reset for testing. */
export function _resetInit(): void {
  _initPromise = null;
  _sharedClient = null;
  _sharedSiteId = null;
  _sharedBranchId = null;
  _sharedCreateAuthClient = null;
}
