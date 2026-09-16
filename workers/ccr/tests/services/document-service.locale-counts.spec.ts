/**
 * Per-locale document counts tell an admin what removing a locale from a site's
 * registry would strand, so a locale missing from the result has to mean the
 * locale holds nothing rather than that the count went unasked.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { documents } from '../../src/db/schema';
import { countDocumentsByLocale } from '../../src/services/document-service';

describe('countDocumentsByLocale', () => {
  let stub: DatabaseStub;

  beforeEach(() => {
    stub = stubDatabase();
  });

  it('counts the documents a site holds in each locale', async () => {
    stub.on(documents).select.returnsRaw([
      { locale: 'de', count: 12 },
      { locale: 'ja', count: 4 },
    ]);

    expect(await countDocumentsByLocale('site-123')).toEqual({ de: 12, ja: 4 });
  });

  it('returns nothing for a site whose documents have no locale', async () => {
    expect(await countDocumentsByLocale('site-123')).toEqual({});
  });

  it('leaves archived documents out of the count', async () => {
    await countDocumentsByLocale('site-123');

    const [call] = stub.calls(documents).select;
    expect(call?.sql).toContain('"archived_at" is null');
  });

  it('scopes the count to the site it was asked about', async () => {
    await countDocumentsByLocale('site-123');

    const [call] = stub.calls(documents).select;
    expect(call?.params).toEqual(['site-123']);
  });
});
