/**
 * SDK-internal data layer initialization.
 *
 * Called lazily by createP1Handler / createP1Pages on the first
 * request. Deduplicates so the init runs at most once regardless
 * of how many entry points import it.
 */

import { initializeStores } from "./index";
import type { EditorMetaStore, RemoteDatasourceDefStore } from "./types";
import { createCSSPageStore, type CSSStoreClient } from "./css-store";

export interface P1DataConfig {
  /** Base URL of the API. */
  cssBaseUrl?: string;

  /** API key for the backend. */
  cssApiKey?: string;

  /** Site ID in the backend. */
  cssSiteId?: string;

  /**
   * Branch ID. When omitted the SDK auto-detects the main branch.
   */
  cssBranchId?: string;
}

let _initPromise: Promise<void> | null = null;

/**
 * Ensures data stores are initialized. Safe to call from multiple
 * entry points — runs only once and subsequent calls return the
 * same resolved promise.
 */
export function ensureInitialized(dataConfig: P1DataConfig): Promise<void> {
  if (!_initPromise) {
    _initPromise = doInit(dataConfig);
  }
  return _initPromise;
}

async function doInit(cfg: P1DataConfig): Promise<void> {
  const { cssBaseUrl, cssSiteId } = cfg;

  if (!cssBaseUrl || !cssSiteId) {
    throw new Error(
      "Missing required config: cssBaseUrl and cssSiteId must be set.",
    );
  }

  // Dynamic import so @pantheon-systems/css-client is only loaded when needed.
  const cssClientModule = await import("@pantheon-systems/css-client");
  const CSSClientCtor = cssClientModule.CSSClient as new (opts: { baseUrl: string; apiKey?: string; authProvider?: () => Promise<string> }) => CSSStoreClient & { branches: { list(siteId: string): Promise<{ id: string; isMain: boolean }[]> } };

  const client = new CSSClientCtor({
    baseUrl: cssBaseUrl,
    apiKey: cfg.cssApiKey,
  });

  // Auto-detect main branch when no branchId provided.
  let branchId: string = cfg.cssBranchId ?? "";
  if (!branchId) {
    const branches = await client.branches.list(cssSiteId);
    const main = branches.find((b: { isMain: boolean }) => b.isMain);
    if (!main) {
      throw new Error("No main branch found for site " + cssSiteId);
    }
    branchId = main.id;
  }

  const pageStore = createCSSPageStore({
    client,
    siteId: cssSiteId,
    branchId,
    createAuthClient: (bearerToken: string) => {
      return new CSSClientCtor({
        baseUrl: cssBaseUrl,
        authProvider: async () => `Bearer ${bearerToken}`,
      }) as unknown as CSSStoreClient;
    },
  });

  // In-memory stores for editor metadata and remote datasource definitions.
  // These don't have CSS-backed implementations yet — the in-memory defaults
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

/** Reset for testing. */
export function _resetInit(): void {
  _initPromise = null;
}
