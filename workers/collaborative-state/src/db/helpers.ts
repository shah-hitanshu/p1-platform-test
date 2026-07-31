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
