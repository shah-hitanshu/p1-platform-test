import { describe, expect, it } from 'vitest';
import { describeQuery } from '../src/db';

/**
 * These attributes are what a dashboard groups database work by, so a wrong value is
 * worse than a missing one: it looks like data. The original pattern captured the
 * schema rather than the table, and since every table here is written `app.<table>`,
 * `db.collection.name` was the constant `app` on every line ever logged.
 */
describe('describeQuery', () => {
  it.each([
    ['SELECT * FROM app.users WHERE id = $1', 'select', 'users'],
    ['INSERT INTO app.document_versions (site_id) VALUES ($1)', 'insert', 'document_versions'],
    ['UPDATE app.branches SET name = $1 WHERE id = $2', 'update', 'branches'],
    ['DELETE FROM app.user_site_roles WHERE id = $1', 'delete', 'user_site_roles'],
  ])('reads the table, not the schema, from %s', (sql, operation, table) => {
    expect(describeQuery(sql)).toEqual({
      'db.operation.name': operation,
      'db.collection.name': table,
    });
  });

  it('never reports the schema as the collection', () => {
    const statements = [
      'SELECT * FROM app.users',
      'UPDATE app.branches SET a = 1',
      'DELETE FROM app.sites WHERE id = $1',
      'INSERT INTO app.sites (id) VALUES ($1)',
    ];
    for (const sql of statements) {
      expect(describeQuery(sql)['db.collection.name']).not.toBe('app');
    }
  });

  it('handles quoted and unqualified identifiers', () => {
    expect(describeQuery('select * from "app"."branches"')['db.collection.name']).toBe('branches');
    expect(describeQuery('SELECT * FROM sites')['db.collection.name']).toBe('sites');
  });

  /** `with` is not an operation anyone queries by, and the CTE's tables are not the target. */
  it('reports the operation a CTE performs, on the statement’s own table', () => {
    expect(describeQuery('WITH t AS (SELECT 1) INSERT INTO app.sites SELECT * FROM t')).toEqual({
      'db.operation.name': 'insert',
      'db.collection.name': 'sites',
    });
    expect(
      describeQuery('WITH RECURSIVE r AS (SELECT 1 UNION SELECT 2) DELETE FROM app.tmp'),
    ).toEqual({ 'db.operation.name': 'delete', 'db.collection.name': 'tmp' });
  });

  it('ignores a subquery’s table in favour of the outer one', () => {
    expect(describeQuery('SELECT * FROM app.x WHERE y IN (SELECT z FROM app.inner_t)')).toEqual({
      'db.operation.name': 'select',
      'db.collection.name': 'x',
    });
    expect(
      describeQuery('WITH t AS (SELECT a FROM app.other) SELECT * FROM app.main'),
    ).toEqual({ 'db.operation.name': 'select', 'db.collection.name': 'main' });
  });

  it('degrades to `other` rather than guessing', () => {
    expect(describeQuery('VACUUM')).toEqual({ 'db.operation.name': 'other' });
  });

  /** Cardinality is the whole point: the statement text must never reach a log field. */
  it('emits nothing resembling the statement or its parameters', () => {
    const described = describeQuery("SELECT * FROM app.users WHERE email = 'a@b.com'");
    expect(Object.values(described).join(' ')).not.toContain('a@b.com');
    expect(described['db.collection.name']).toBe('users');
  });
});
