/**
 * Gets the first row from a query result, throwing if not present.
 * Use this when an INSERT/UPDATE with RETURNING should always return a row.
 * TODO: Remove duplicate instances of this function across the codebase.
 */
export function getFirstRow<T>(rows: T[]): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error('Expected query to return at least one row');
  }
  return first;
}

/**
 * Normalizes a timestamp column to ISO-8601.
 *
 * A row read through the query builder carries a Date; one read through
 * db().execute() carries Postgres' own text form, because the Drizzle client
 * parses timestamps as identity. The domain types declare these fields as
 * strings, so both are funnelled through here.
 */
export function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
