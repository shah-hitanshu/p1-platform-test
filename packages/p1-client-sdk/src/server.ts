// Server-only exports — modules that use fs, revalidatePath, etc.
// Import from "@pantheon-systems/p1-client-sdk/server" in server components and route handlers.
import "server-only";

// Re-export everything from the client-safe barrel
export * from "./index";

// --- Server-only lib exports ---
export { resolveCrossPageTemplates } from "./lib/cross-reference-resolve";

export {
  resolveStringTemplates,
  resolveDataTemplates,
} from "./lib/resolve-data-templates";

export {
  loadRemoteDatasourceContext,
  type RemoteDatasourceFetcher,
  type RemoteDatasourceFetcherParams,
  type LoadRemoteDatasourceContextOpts,
} from "./lib/remote-datasources/loader";

export { getPage } from "./lib/get-page";

export {
  type PageEditorMetaRow,
  type PageEditorMetaFile,
  getPageEditorPreviewParams,
  getPageEditorMetaRow,
  setPageEditorMetaRow,
  removePageEditorMetaPath,
  setPageEditorPreviewParams,
} from "./lib/page-editor-meta";

export type {
  PageStore,
  EditorMetaStore,
  RemoteDatasourceDefStore,
} from "./lib/dal";
export {
  pageStore,
  editorMetaStore,
  remoteDatasourceDefStore,
} from "./lib/dal";

export {
  createStaticPage,
  createCollectionTemplate,
  deletePageAtPath,
  flattenStructureRoutes,
  isSemanticPatchEntry,
  isOverrideEntry,
  resolvePageData,
  resolveCanonicalForPatchBase,
  persistPublishedPage,
  listRoutes,
  listRouteTemplateKeysFromDatabase,
  createCollectionOverride,
  listOverridePathsForBase,
} from "./lib/page-store";

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
} from "./lib/remote-datasources/user-remote-datasource-store";

// --- Server page component exports ---
export { default as StructurePage } from "./pages/structure-page";

// --- Handler exports (NextAuth-style catch-all) ---
export { createP1Handler, type P1HandlerConfig } from "./handler";
export { createP1Pages, type P1PagesConfig } from "./pages-handler";
