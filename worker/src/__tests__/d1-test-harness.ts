// Real local-D1 test harness (not a test file — excluded from vitest's *.test.ts glob).
//
// The store's R0/R2/R3 guarantees (site-scoping, immutable no-clobber writes, and
// batch() atomicity) cannot be verified against a hand-mock — a fake would just
// return whatever we told it to. So the store's composite ops are exercised against
// a REAL SQLite engine (Node's stable `node:sqlite`) with the SHIPPED migration
// applied, wired behind an adapter that implements the exact D1Database subset the
// store calls. R2 is mocked because the tests need to *inject* a put failure (R3)
// and honour the immutable conditional put; the mock models both.

import { DatabaseSync } from 'node:sqlite';
import migrationSql from '../../migrations/0001_init_assets.sql?raw';
import type { Env, MediaAsset } from '../types';
import { buildKey, finalizeAssetCreation } from '../store';

// ---------------------------------------------------------------------------
// D1Database adapter over node:sqlite
// ---------------------------------------------------------------------------

class D1StatementAdapter {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): D1StatementAdapter {
    return new D1StatementAdapter(this.db, this.sql, params);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(info.changes) } };
  }
}

class D1DatabaseAdapter {
  // Serializes overlapping batch() calls against the single underlying connection.
  // Real D1 doesn't error when two concurrent requests both call batch() against the
  // same database — it serializes them, same as any single-writer SQLite engine. A
  // raw `db.exec('BEGIN')` per call can't model that (node:sqlite's DatabaseSync has
  // exactly one connection, so a second BEGIN before the first COMMITs throws "cannot
  // start a transaction within a transaction") — this queue makes overlapping calls
  // wait their turn instead, so tests can exercise genuine request-level concurrency
  // (e.g. two racing finalize calls) without hitting an adapter artifact.
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): D1StatementAdapter {
    return new D1StatementAdapter(this.db, sql);
  }

  // D1 runs batch() as a single implicit transaction: all statements commit, or
  // none do. Model that faithfully so the store's R3 atomicity is really tested —
  // if any statement throws (e.g. a constraint violation), roll the whole batch back.
  async batch(statements: D1StatementAdapter[]): Promise<{ meta: { changes: number } }[]> {
    const previous = this.queue;
    let releaseNext: () => void;
    this.queue = new Promise((resolve) => {
      releaseNext = resolve;
    });
    await previous;

    try {
      this.db.exec('BEGIN');
      const out: { meta: { changes: number } }[] = [];
      for (const stmt of statements) out.push(await stmt.run());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      releaseNext!();
    }
  }
}

// ---------------------------------------------------------------------------
// Mock R2 bucket
// ---------------------------------------------------------------------------

interface PutOptions {
  httpMetadata?: { contentType?: string };
}

export interface MockBucket extends R2Bucket {
  /** Keys currently stored — for asserting what did (or did not) land in R2. */
  readonly _keys: Set<string>;
  /**
   * Test-only: backdates an already-put object's `uploaded` timestamp, so age-gated
   * logic (the reconcile job) can be exercised without wrapping every seed call in
   * fake timers. Real R2 has no equivalent — `uploaded` is always server-set at
   * write time.
   */
  _backdate(key: string, date: Date): void;
}

export function createMockBucket(opts: { pageSize?: number } = {}): MockBucket {
  const objects = new Map<string, { body: unknown; contentType?: string; size: number; uploaded: Date }>();
  const pageSize = opts.pageSize ?? 1000; // real R2's default list() page size

  const bucket = {
    _keys: new Set<string>(),
    async put(key: string, body: unknown, options?: PutOptions) {
      const size = typeof body === 'string' ? body.length : (body as ArrayBuffer)?.byteLength ?? 0;
      objects.set(key, { body, contentType: options?.httpMetadata?.contentType, size, uploaded: new Date() });
      (bucket._keys as Set<string>).add(key);
      return { key };
    },
    // `range` is accepted but not applied — tests here don't assert on partial-read
    // slicing (a real-R2 concern), only on the dimension-capture call path itself.
    async get(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return { body: obj.body, httpMetadata: { contentType: obj.contentType } };
    },
    async head(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return { key, size: obj.size, httpMetadata: { contentType: obj.contentType } };
    },
    async delete(key: string) {
      objects.delete(key);
      (bucket._keys as Set<string>).delete(key);
    },
    // Sorted keys give deterministic pages. The cursor is the last key of the
    // previous page (real R2/S3 pagination is key-anchored, not index-anchored) —
    // an index-based cursor would silently skip or re-return keys whenever a
    // caller deletes an object between list() calls, exactly as this job does.
    async list(options?: { cursor?: string }) {
      const keys = [...objects.keys()].sort();
      const start = options?.cursor ? keys.findIndex((k) => k > options.cursor!) : 0;
      const from = start === -1 ? keys.length : start;
      const page = keys.slice(from, from + pageSize);
      const truncated = from + pageSize < keys.length;
      return {
        objects: page.map((key) => {
          const obj = objects.get(key)!;
          return { key, size: obj.size, uploaded: obj.uploaded, httpMetadata: { contentType: obj.contentType } };
        }),
        truncated,
        cursor: truncated ? page[page.length - 1] : undefined,
      };
    },
    _backdate(key: string, date: Date) {
      const obj = objects.get(key);
      if (obj) obj.uploaded = date;
    },
  };

  return bucket as unknown as MockBucket;
}

// ---------------------------------------------------------------------------
// Env factory
// ---------------------------------------------------------------------------

export interface TestHarness {
  env: Env;
  db: DatabaseSync;
  bucket: MockBucket;
}

/**
 * Builds an Env whose MEDIA_DB is a real in-memory SQLite with the shipped migration
 * applied, and whose MEDIA_BUCKET is a mock. Returns the raw db + bucket too so tests
 * can assert directly on persisted rows / stored keys. `bucketPageSize` shrinks the
 * mock bucket's list() page size so pagination (the reconcile job's cursor loop) is
 * exercisable without seeding hundreds of objects.
 */
export function createTestHarness(opts: { bucketPageSize?: number } = {}): TestHarness {
  const db = new DatabaseSync(':memory:');
  db.exec(migrationSql);
  const bucket = createMockBucket({ pageSize: opts.bucketPageSize });

  const env: Env = {
    MEDIA_BUCKET: bucket,
    MEDIA_DB: new D1DatabaseAdapter(db) as unknown as D1Database,
    CSS_BASE_URL: 'https://css.example.com',
    CDN_BASE_URL: 'https://cdn.example.com/p1',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    IMAGES: {} as ImagesBinding,
  };

  return { env, db, bucket };
}

/** Convenience: count rows in a table (for atomicity assertions). */
export function countRows(db: DatabaseSync, table: 'assets' | 'asset_versions'): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return Number(row.c);
}

/**
 * Test-only fixture helper: mints an assetId/versionId, puts bytes directly into the
 * mock bucket (standing in for a client's presigned PUT, which this test harness never
 * exercises), then calls the real `finalizeAssetCreation` to write the D1 rows — the
 * same production code path every asset in the store now goes through. Exists so the
 * many describe blocks below that just need SOME seeded asset (list/search/patch/
 * soft-delete/add-version) don't each hand-rolled their own R2+D1 setup.
 */
export async function seedAsset(
  env: Env,
  bucket: MockBucket,
  overrides: {
    siteId: string;
    filename: string;
    contentType?: string;
    size?: number;
    width?: number;
    height?: number;
    body?: string;
    metadata?: Record<string, string>;
    createdBy?: string;
  },
): Promise<MediaAsset> {
  const assetId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const key = buildKey(overrides.siteId, assetId, versionId, overrides.filename);
  await bucket.put(key, overrides.body ?? 'x', {
    httpMetadata: { contentType: overrides.contentType ?? 'image/png' },
  });
  return finalizeAssetCreation(env, {
    siteId: overrides.siteId,
    assetId,
    versionId,
    filename: overrides.filename,
    contentType: overrides.contentType ?? 'image/png',
    size: overrides.size ?? 1,
    width: overrides.width,
    height: overrides.height,
    metadata: overrides.metadata,
    createdBy: overrides.createdBy,
  });
}
