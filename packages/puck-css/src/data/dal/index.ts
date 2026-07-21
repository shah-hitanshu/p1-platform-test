/**
 * Data Access Layer — abstracts how page data, editor metadata, and
 * datasource definitions are persisted.
 *
 * Stores must be initialized at startup via initializeStores()
 * before any route handler or server component accesses them.
 */

export type { PageStore, PageSetOptions, EditorMetaStore, RemoteDatasourceDefStore, StoreCapabilities } from "./types";

import type { PageStore, EditorMetaStore, RemoteDatasourceDefStore, StoreCapabilities } from "./types";
import type { TemplateStore } from "../../features/content-type-templates/stores/template-store.js";

// --- Lazy-initialized store instances ---

let _pageStore: PageStore | null = null;
let _editorMetaStore: EditorMetaStore | null = null;
let _remoteDatasourceDefStore: RemoteDatasourceDefStore | null = null;
let _templateStore: TemplateStore | null = null;

export function getPageStore(): PageStore {
  if (!_pageStore) throw new Error("Page store not initialized. Call ensureInitialized() first.");
  return _pageStore;
}

export function getEditorMetaStore(): EditorMetaStore {
  if (!_editorMetaStore) throw new Error("Editor meta store not initialized. Call ensureInitialized() first.");
  return _editorMetaStore;
}

export function getRemoteDatasourceDefStore(): RemoteDatasourceDefStore {
  if (!_remoteDatasourceDefStore) throw new Error("Remote datasource def store not initialized. Call ensureInitialized() first.");
  return _remoteDatasourceDefStore;
}

export function getTemplateStore(): TemplateStore {
  if (!_templateStore) throw new Error("Template store not initialized. Call ensureInitialized() first.");
  return _templateStore;
}

/**
 * Replace the active store instances. Call this at app startup
 * before any route handlers or server components access the stores.
 *
 * Only the stores you provide are replaced; omitted stores keep
 * their current value.
 */
export function initializeStores(stores: {
  pageStore?: PageStore;
  editorMetaStore?: EditorMetaStore;
  remoteDatasourceDefStore?: RemoteDatasourceDefStore;
  templateStore?: TemplateStore;
}): void {
  if (stores.pageStore) _pageStore = stores.pageStore;
  if (stores.editorMetaStore) _editorMetaStore = stores.editorMetaStore;
  if (stores.remoteDatasourceDefStore) _remoteDatasourceDefStore = stores.remoteDatasourceDefStore;
  if (stores.templateStore) _templateStore = stores.templateStore;
}

/**
 * Returns the capabilities of the current store backend.
 */
export function getCapabilities(): StoreCapabilities {
  return {
    branching: true,
    versioning: true,
    realtime: true,
    merge: true,
  };
}

// --- Backward-compatible singleton exports ---
// These call the getters on each access so they reflect any
// store swap made via initializeStores().

export const pageStore: PageStore = {
  get(path: string) { return getPageStore().get(path); },
  set(path: string, value: unknown, options?) { return getPageStore().set(path, value, options); },
  delete(path: string) { return getPageStore().delete(path); },
  has(path: string) { return getPageStore().has(path); },
  keys() { return getPageStore().keys(); },
};

export const editorMetaStore: EditorMetaStore = {
  get(path: string) { return getEditorMetaStore().get(path); },
  set(path: string, row: Record<string, unknown>) { getEditorMetaStore().set(path, row); },
  delete(path: string) { getEditorMetaStore().delete(path); },
};

export const remoteDatasourceDefStore: RemoteDatasourceDefStore = {
  list() { return getRemoteDatasourceDefStore().list(); },
  save(remoteDatasources: unknown[]) { getRemoteDatasourceDefStore().save(remoteDatasources); },
};

export const templateStore: TemplateStore = {
  create(params) { return getTemplateStore().create(params); },
  get(id) { return getTemplateStore().get(id); },
  list() { return getTemplateStore().list(); },
  update(id, params) { return getTemplateStore().update(id, params); },
  delete(id) { return getTemplateStore().delete(id); },
  getBinding(documentId) { return getTemplateStore().getBinding(documentId); },
  setBinding(documentId, templateId, templateVersion) {
    return getTemplateStore().setBinding(documentId, templateId, templateVersion);
  },
  listBindings(templateId) { return getTemplateStore().listBindings(templateId); },
  removeBinding(documentId) { return getTemplateStore().removeBinding(documentId); },
};
