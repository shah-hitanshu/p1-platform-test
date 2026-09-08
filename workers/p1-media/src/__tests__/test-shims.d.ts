// Ambient declarations for test-only imports.
//
// tsconfig loads ONLY @cloudflare/workers-types (no @types/node), so the two
// Node/Vite features the D1 test harness relies on need minimal local decls to
// satisfy `tsc --noEmit`. They are scoped to the test tree and never ship.

// The stable `node:sqlite` built-in (Node >= 22.5, GA in 24+). Only the subset the
// D1 adapter uses is declared.
declare module 'node:sqlite' {
  export interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string, options?: unknown);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

// Vite `?raw` import — inlines a file's contents as a string at transform time.
// Used to load the real migration SQL so tests exercise the shipped schema.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}

// Vite's import.meta.glob — tsconfig pins `types` to workers-types, so vite/client's
// declaration isn't in scope. Only the narrow shape the harness uses.
interface ImportMeta {
  glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, unknown>;
}
