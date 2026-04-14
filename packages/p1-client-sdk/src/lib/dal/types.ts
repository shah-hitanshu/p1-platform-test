/** Page data store — keyed by route path (e.g. "/", "/about", "/jedi/:id"). */
export interface PageStore {
  get(path: string): unknown | undefined;
  set(path: string, value: unknown): void;
  delete(path: string): void;
  has(path: string): boolean;
  keys(): string[];
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
