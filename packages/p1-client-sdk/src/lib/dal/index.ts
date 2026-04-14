/**
 * Data Access Layer — abstracts how page data, editor metadata, and
 * datasource definitions are persisted.
 *
 * Swap the factory calls below to change the backend (e.g. remote API)
 * without touching business logic.
 */

export type { PageStore, EditorMetaStore, RemoteDatasourceDefStore } from "./types";

export {
  createLocalPageStore,
  createLocalEditorMetaStore,
  createLocalRemoteDatasourceDefStore,
} from "./local-json-store";

import { createLocalPageStore, createLocalEditorMetaStore, createLocalRemoteDatasourceDefStore } from "./local-json-store";

// --- Active store instances (swap these to change backend) ---

export const pageStore: import("./types").PageStore =
  createLocalPageStore("database.json");

export const editorMetaStore: import("./types").EditorMetaStore =
  createLocalEditorMetaStore("page-editor-meta.json");

export const remoteDatasourceDefStore: import("./types").RemoteDatasourceDefStore =
  createLocalRemoteDatasourceDefStore("remote-datasource-definitions.json");
