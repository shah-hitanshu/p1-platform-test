/** Describes what features are available with the current store backend. */
export interface StoreCapabilities {
  /** Multi-branch support. */
  branching: boolean;
  /** Version history. */
  versioning: boolean;
  /** Real-time collaboration. */
  realtime: boolean;
  /** Branch merge / conflict resolution. */
  merge: boolean;
}

/** Minimal document metadata returned by listDocuments. */
export interface DocumentMeta {
  path: string;
  templateId?: string | null;
}

/** Optional metadata when creating/updating a page. */
export interface PageSetOptions {
  templateId?: string;
  templateVersion?: number;
}

/** Page data store — keyed by route path (e.g. "/", "/about", "/jedi/:id"). */
export interface PageStore {
  get(path: string): Promise<unknown | undefined>;
  set(path: string, value: unknown, options?: PageSetOptions): Promise<void>;
  delete(path: string): Promise<void>;
  has(path: string): Promise<boolean>;
  keys(): Promise<string[]>;
  /** List documents with metadata. Falls back to keys() when not available. */
  listDocuments?(): Promise<DocumentMeta[]>;
}

/** Editor metadata store — keyed by route path. */
export interface EditorMetaStore {
  get(path: string): Record<string, unknown> | undefined;
  set(path: string, row: Record<string, unknown>): void;
  delete(path: string): void;
}

/** Global remote datasource definitions store. */
export interface RemoteDatasourceDefStore {
  list(): unknown[];
  save(remoteDatasources: unknown[]): void;
}
