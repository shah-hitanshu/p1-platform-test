import { describe, it, expect } from 'vitest';
import {
  escapeLike,
  buildListQuery,
  sanitizeFilename,
  buildKey,
  cdnUrl,
  rowToAsset,
} from '../store';
import type { AssetRow, AssetVersionRow } from '../types';

// These are the pure, DB-free helpers. The composite R2+D1 operations
// (finalizeAssetCreation / finalizeVersionAdd / updateAssetMetadata / softDeleteAsset)
// are intentionally NOT unit-tested here — asserting prepare/bind/batch shapes
// against a hand-mocked D1 tests the mock, not the SQL. Their real behavior is
// covered by a separate real-SQLite smoke; see the summary for the honest matrix.

// ---------------------------------------------------------------------------
// escapeLike (R11) — user search terms must match LITERALLY, so SQL LIKE
// wildcards the user typed can't turn into wildcards in the query.
// ---------------------------------------------------------------------------

describe('escapeLike', () => {
  it('escapes the three LIKE metacharacters: % _ and backslash', () => {
    // Input a%b_c\d  →  a\%b\_c\\d  (backslash itself must be escaped first-class,
    // otherwise the ESCAPE char would be interpreted by SQLite).
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('leaves ordinary characters untouched', () => {
    expect(escapeLike('hero-banner.jpg')).toBe('hero-banner.jpg');
  });

  it('escapes a lone % so "50%" searches for the literal string, not any-suffix', () => {
    expect(escapeLike('50%')).toBe('50\\%');
  });
});

// ---------------------------------------------------------------------------
// buildListQuery — the site scope and R11 escaping must be visible in the built
// query/params, because that is the boundary that keeps one site from listing
// another's assets and keeps wildcards literal.
// ---------------------------------------------------------------------------

describe('buildListQuery', () => {
  it('always scopes to the owning site and excludes soft-deleted rows', () => {
    const { sql, params } = buildListQuery({ siteId: 'site-1', limit: 50 });
    // R0: every listing is site-scoped by a bound param, never interpolated.
    expect(sql).toContain('a.site_id = ?');
    expect(sql).toContain('a.deleted_at IS NULL');
    expect(params[0]).toBe('site-1');
  });

  it('binds the limit last and never inlines it', () => {
    const { sql, params } = buildListQuery({ siteId: 'site-1', limit: 42 });
    expect(sql).toContain('LIMIT ?');
    expect(params[params.length - 1]).toBe(42);
  });

  it('omits the search clause entirely when no term is given', () => {
    const { sql, params } = buildListQuery({ siteId: 'site-1', limit: 50 });
    expect(sql).not.toContain('LIKE');
    expect(params).toEqual(['site-1', 50]);
  });

  it('parameterizes the search term with an escaped, lowercased LIKE on filename, alt, and metadata values', () => {
    const { sql, params } = buildListQuery({ siteId: 'site-1', search: '50%_off', limit: 10 });
    // Search must match filename OR alt OR any metadata VALUE, all under an explicit ESCAPE '\'.
    expect(sql).toContain('LOWER(a.filename) LIKE ?');
    expect(sql).toContain('LOWER(a.alt) LIKE ?');
    expect(sql).toContain('json_each(a.metadata)');
    expect(sql).toContain('LOWER(json_each.value) LIKE ?');
    expect(sql).toContain("ESCAPE '\\'");
    // One corrupt blob must not fail the whole listing — the value scan is guarded.
    expect(sql).toContain('json_valid(a.metadata)');
    // Values only: the key column is never matched, so a term like "caption"
    // cannot match every asset that merely HAS a caption field.
    expect(sql).not.toContain('json_each.key');
    // R11: the wildcards the user typed are escaped inside the BOUND param — never
    // interpolated into the SQL — and the term is lowercased for case-insensitive match.
    const expectedLike = '%50\\%\\_off%';
    expect(params).toEqual(['site-1', expectedLike, expectedLike, expectedLike, 10]);
  });

  it('lowercases the search term so matching is case-insensitive', () => {
    const { params } = buildListQuery({ siteId: 's', search: 'ALPHA', limit: 5 });
    expect(params).toContain('%alpha%');
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilename — the output becomes part of an R2 key, so it must never
// carry path separators, control chars, or unbounded length.
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('replaces spaces and punctuation with hyphens, keeping dots and hyphens', () => {
    expect(sanitizeFilename('my photo (1).jpg')).toBe('my-photo--1-.jpg');
  });

  it('collapses runs of dots so no path-traversal / hidden segments survive', () => {
    expect(sanitizeFilename('a...b.png')).toBe('a-b.png');
  });

  it('strips leading and trailing dots', () => {
    expect(sanitizeFilename('.hidden.')).toBe('hidden');
  });

  it('truncates to at most 200 chars so the composed R2 key stays under R2 limits', () => {
    const result = sanitizeFilename('a'.repeat(300) + '.jpg');
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// buildKey — the exact R2 key format that the CDN URL and reconcile sweep both
// depend on. A drift here silently breaks serving and orphan cleanup.
// ---------------------------------------------------------------------------

describe('buildKey', () => {
  it('composes {siteId}/assets/{assetId}/{versionId}-{filename}', () => {
    expect(buildKey('site1', 'asset1', 'ver1', 'photo.jpg')).toBe(
      'site1/assets/asset1/ver1-photo.jpg',
    );
  });
});

// ---------------------------------------------------------------------------
// cdnUrl — must encode each path SEGMENT independently so a space/# in a
// filename is escaped, while the "/" separators survive (not turned into %2F).
// ---------------------------------------------------------------------------

describe('cdnUrl', () => {
  it('encodes each segment but preserves the slash separators', () => {
    expect(cdnUrl('https://cdn.example.com/p1', 'site1/assets/a1/v1-my photo.jpg')).toBe(
      'https://cdn.example.com/p1/site1/assets/a1/v1-my%20photo.jpg',
    );
  });

  it('encodes reserved characters within a segment', () => {
    expect(cdnUrl('https://cdn.example.com', 's/v-a#b.jpg')).toBe(
      'https://cdn.example.com/s/v-a%23b.jpg',
    );
  });
});

// ---------------------------------------------------------------------------
// rowToAsset — the D1 row → API shape mapping. The load-bearing contract is
// that the promoted `alt` column is folded back INTO the flat metadata map, and
// that a corrupt metadata blob degrades to {} rather than throwing.
// ---------------------------------------------------------------------------

function baseRow(overrides: Partial<AssetRow & AssetVersionRow> = {}): AssetRow & Partial<AssetVersionRow> {
  return {
    asset_id: 'a1',
    site_id: 's1',
    org_id: null,
    filename: 'photo.jpg',
    alt: null,
    metadata: null,
    meta_schema_version: 1,
    current_version: 'v1',
    created_at: '2025-01-01T00:00:00Z',
    created_by: null,
    deleted_at: null,
    version_id: 'v1',
    r2_key: 's1/assets/a1/v1-photo.jpg',
    content_type: 'image/jpeg',
    size: 2048,
    width: 800,
    height: 600,
    uploaded_at: '2025-01-01T00:00:00Z',
    uploaded_by: null,
    ...overrides,
  };
}

describe('rowToAsset', () => {
  it('maps identity/version columns and builds the immutable CDN url', () => {
    const asset = rowToAsset(baseRow(), 'https://cdn.example.com/p1');
    expect(asset.assetId).toBe('a1');
    expect(asset.versionId).toBe('v1'); // versionId is the asset's current_version
    expect(asset.url).toBe('https://cdn.example.com/p1/s1/assets/a1/v1-photo.jpg');
    expect(asset.filename).toBe('photo.jpg');
    expect(asset.contentType).toBe('image/jpeg');
    expect(asset.size).toBe(2048);
    expect(asset.width).toBe(800);
    expect(asset.height).toBe(600);
    expect(asset.metaSchemaVersion).toBe(1);
    expect(asset.createdAt).toBe('2025-01-01T00:00:00Z');
  });

  it('folds the promoted alt column INTO the flat metadata map alongside the JSON blob', () => {
    const asset = rowToAsset(
      baseRow({ alt: 'a cat', metadata: '{"caption":"nice","credit":"me"}' }),
      'https://cdn.example.com/p1',
    );
    // A schema-driven consumer must address alt the same way as caption/credit.
    expect(asset.metadata).toEqual({ caption: 'nice', credit: 'me', alt: 'a cat' });
  });

  it('degrades a corrupt metadata blob to {} instead of throwing (never fail a whole listing)', () => {
    const asset = rowToAsset(
      baseRow({ alt: 'still here', metadata: '{not valid json' }),
      'https://cdn.example.com/p1',
    );
    // The unparseable blob is dropped, but the promoted alt column still surfaces.
    expect(asset.metadata).toEqual({ alt: 'still here' });
  });

  it('omits alt from metadata when the column is null', () => {
    const asset = rowToAsset(
      baseRow({ alt: null, metadata: '{"caption":"c"}' }),
      'https://cdn.example.com/p1',
    );
    expect(asset.metadata).toEqual({ caption: 'c' });
    expect('alt' in asset.metadata).toBe(false);
  });

  it('omits optional numeric/type fields when their columns are null', () => {
    const asset = rowToAsset(
      baseRow({ content_type: null, size: null, width: null, height: null }),
      'https://cdn.example.com/p1',
    );
    expect(asset.contentType).toBeUndefined();
    expect(asset.size).toBeUndefined();
    expect(asset.width).toBeUndefined();
    expect(asset.height).toBeUndefined();
  });
});
