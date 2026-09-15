import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { stubDatabase } from './database';
import { documents, sites } from '../../src/db/schema';

describe('stubDatabase', () => {
  it('answers a select with the rows stubbed for that table', async () => {
    const { db, on } = stubDatabase();
    on(sites).select.returns([{ id: 'site-1', name: 'Docs' }]);

    const rows = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(eq(sites.id, 'site-1'));

    expect(rows).toEqual([{ id: 'site-1', name: 'Docs' }]);
  });

  it('returns no rows for a query the test never stubbed', async () => {
    const { db, on } = stubDatabase();
    on(sites).select.returns([{ id: 'site-1' }]);

    const rows = await db.select({ id: documents.id }).from(documents);

    expect(rows).toEqual([]);
  });

  it('answers by the parameters a query binds when one table serves two questions', async () => {
    const { db, on } = stubDatabase();
    on(sites).select.whenBound(['site-1']).returns([{ id: 'site-1', name: 'Docs' }]);
    on(sites).select.whenBound(['site-2']).returns([{ id: 'site-2', name: 'Blog' }]);

    expect(await db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.id, 'site-2')))
      .toEqual([{ id: 'site-2', name: 'Blog' }]);
    expect(await db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.id, 'site-1')))
      .toEqual([{ id: 'site-1', name: 'Docs' }]);
  });

  it('falls back to the unconditional stub when no bound stub matches', async () => {
    const { db, on } = stubDatabase();
    on(sites).select.returns([{ id: 'fallback' }]);
    on(sites).select.whenBound(['site-1']).returns([{ id: 'site-1' }]);

    expect(await db.select({ id: sites.id }).from(sites).where(eq(sites.id, 'site-9')))
      .toEqual([{ id: 'fallback' }]);
  });

  it('keeps stubs separate per operation', async () => {
    const { db, on } = stubDatabase();
    on(sites).select.returns([{ id: 'existing' }]);
    on(sites).insert.returns([{ id: 'created' }]);

    const inserted = await db
      .insert(sites)
      .values({ id: 'created', pantheonSiteId: 'p-1', name: 'New' })
      .returning({ id: sites.id });

    expect(inserted).toEqual([{ id: 'created' }]);
  });

  it('records the parameters a query ran with', async () => {
    const { db, on, calls } = stubDatabase();
    on(sites).select.returns([]);

    await db.select({ id: sites.id }).from(sites).where(eq(sites.id, 'site-7'));

    expect(calls(sites).select).toHaveLength(1);
    expect(calls(sites).select[0].params).toEqual(['site-7']);
  });

  it('serves queries issued inside a transaction', async () => {
    const { db, on } = stubDatabase();
    on(sites).select.returns([{ id: 'in-tx' }]);

    const rows = await db.transaction(async (tx) =>
      tx.select({ id: sites.id }).from(sites),
    );

    expect(rows).toEqual([{ id: 'in-tx' }]);
  });

  it('exposes every statement in order', async () => {
    const { db, on, statements } = stubDatabase();
    on(sites).select.returns([]);
    on(documents).select.returns([]);

    await db.select({ id: sites.id }).from(sites);
    await db.select({ id: documents.id }).from(documents);

    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain('"app"."sites"');
    expect(statements[1].sql).toContain('"app"."documents"');
  });
});
