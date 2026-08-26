/**
 * Per-locale document counts tell an admin what removing a locale from a site's
 * registry would strand, so a locale missing from the result has to mean the
 * locale holds nothing rather than that the count went unasked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  query: vi.fn(),
}));

describe('countDocumentsByLocale', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('counts the documents a site holds in each locale', async () => {
    const db = await import('../../src/db');
    const { countDocumentsByLocale } = await import('../../src/services/document-service');

    vi.mocked(db.query).mockResolvedValue({
      rows: [
        { locale: 'de', count: '12' },
        { locale: 'ja', count: '4' },
      ],
      rowCount: 2,
    });

    expect(await countDocumentsByLocale('site-123')).toEqual({ de: 12, ja: 4 });
  });

  it('returns nothing for a site whose documents have no locale', async () => {
    const db = await import('../../src/db');
    const { countDocumentsByLocale } = await import('../../src/services/document-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await countDocumentsByLocale('site-123')).toEqual({});
  });

  it('leaves archived documents out of the count', async () => {
    const db = await import('../../src/db');
    const { countDocumentsByLocale } = await import('../../src/services/document-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

    await countDocumentsByLocale('site-123');

    const [sql] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('archived_at IS NULL');
  });

  it('scopes the count to the site it was asked about', async () => {
    const db = await import('../../src/db');
    const { countDocumentsByLocale } = await import('../../src/services/document-service');

    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });

    await countDocumentsByLocale('site-123');

    const [, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['site-123']);
  });
});
