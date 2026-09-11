import { describe, it, expect, afterEach } from 'vitest';
import { db, withDatabase, installDatabase, inTransaction, NoDatabaseScopeError } from '../src/db/scope';
import { stubDatabase } from './__stubs__/database';

afterEach(() => {
  installDatabase(null);
});

describe('db()', () => {
  it('throws NoDatabaseScopeError when no scope is open and nothing is installed', () => {
    expect(() => db()).toThrow(NoDatabaseScopeError);
  });

  it('returns the handle inside withDatabase', async () => {
    const database = stubDatabase();
    installDatabase(null);
    await withDatabase(database.db, async () => {
      expect(db()).toBe(database.db);
      expect(inTransaction()).toBe(false);
    });
    expect(() => db()).toThrow(NoDatabaseScopeError);
  });

  it('returns the installed fallback outside any scope', () => {
    const database = stubDatabase();
    expect(db()).toBe(database.db);
  });

  it('prefers an open scope over the installed fallback', async () => {
    const installed = stubDatabase();
    const scoped = stubDatabase();
    installDatabase(installed.db);
    await withDatabase(scoped.db, async () => {
      expect(db()).toBe(scoped.db);
    });
    expect(db()).toBe(installed.db);
  });

  it('throws again once the fallback is removed', () => {
    stubDatabase();
    installDatabase(null);
    expect(() => db()).toThrow(NoDatabaseScopeError);
  });
});
