// Server-safe exports for use in Next.js server components, route handlers,
// and any Node.js context. Does NOT re-export the client barrel to avoid
// pulling React context/hooks into server module graphs.

// --- Pure utilities (also in client barrel, re-exported here for server use) ---
export { normalizePath, stripTrailingSlash, isReservedPath, PATH_REGEX } from "./data/paths.js";
export {
  isRouteTemplatePath,
  pagePathFromCatchAllSegments,
  isCanonicalTemplatePath,
  templatePathParamNames,
  defaultInstancePathFromTemplate,
  editorPathHref,
  publicPagePathHref,
  listRouteTemplateKeys,
  matchConcretePathToTemplateParams,
  pathSegments,
} from "./data/route-templates.js";
export { buildRemoteDatasourceRegistry } from "./data/remote-datasources/remote-datasource-registry.js";
export type { RemoteDatasourceDefinition, RemoteDatasourceFieldDoc } from "./data/remote-datasources/remote-datasource-registry.js";
export type { RouteRow, RouteKind } from "./data/page-store.js";
export { flattenStructureRoutes, isSemanticPatchEntry, isOverrideEntry } from "./data/page-store.js";
export type { RemoteDatasourceScope } from "./data/remote-datasources/user-remote-datasource-types.js";

// --- Server-only lib exports ---
export { resolveCrossPageTemplates } from "./data/cross-reference-resolve.js";

export {
  resolveStringTemplates,
  resolveDataTemplates,
} from "./data/resolve-data-templates.js";

export {
  loadRemoteDatasourceContext,
  extractReferencedDatasourceIds,
  type RemoteDatasourceFetcher,
  type RemoteDatasourceFetcherParams,
  type RemoteDatasourceContext,
  type LoadRemoteDatasourceContextOpts,
} from "./data/remote-datasources/loader.js";

export { getPage } from "./data/get-page.js";

export {
  type PageEditorMetaRow,
  type PageEditorMetaFile,
  getPageEditorPreviewParams,
  getPageEditorMetaRow,
  setPageEditorMetaRow,
  removePageEditorMetaPath,
  setPageEditorPreviewParams,
} from "./data/page-editor-meta.js";

export type {
  PageStore,
  EditorMetaStore,
  RemoteDatasourceDefStore,
  StoreCapabilities,
} from "./data/dal/index.js";
export {
  pageStore,
  editorMetaStore,
  remoteDatasourceDefStore,
  getPageStore,
  getEditorMetaStore,
  getRemoteDatasourceDefStore,
  initializeStores,
  getCapabilities,
} from "./data/dal/index.js";

// --- CSS-backed store ---
export { createCSSPageStore } from "./data/dal/css-store.js";
export type { CSSStoreConfig, CSSStoreClient } from "./data/dal/css-store.js";
export { ensureInitialized, type P1DataConfig } from "./data/dal/init.js";
export { runWithAuthToken } from "./data/dal/request-auth.js";

export {
  createStaticPage,
  createCollectionTemplate,
  deletePageAtPath,
  resolvePageData,
  resolveCanonicalForPatchBase,
  persistPublishedPage,
  listRoutes,
  listRouteTemplateKeysFromDatabase,
  createCollectionOverride,
  listOverridePathsForBase,
} from "./data/page-store.js";

export type {
  HttpJsonRemoteDatasourceDefinition,
  RemoteDatasourceFieldDocInput,
} from "./data/remote-datasources/user-remote-datasource-types.js";

export {
  normalizeRemoteDatasourceDefinition,
  listGlobalRemoteDatasources,
  upsertGlobalRemoteDatasource,
  deleteGlobalRemoteDatasource,
  listPageRemoteDatasources,
  upsertPageRemoteDatasource,
  deletePageRemoteDatasource,
  listRemoteDatasourcesForPage,
  idConflictsForRemoteDatasourceScope,
} from "./data/remote-datasources/user-remote-datasource-store.js";

// --- Server page component exports ---
export { default as StructurePage } from "./p1/pages/structure-page.js";
