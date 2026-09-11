/**
 * Low-cardinality description of a statement: the operation and the primary table.
 *
 * Deliberately not the statement text — it can embed customer content, and as a log
 * field it would be unbounded cardinality. This is also why sqlcommenter is not applied
 * per request: Hyperdrive caches by query text, so a unique comment per request would
 * drive its hit rate to zero.
 *
 * The schema qualifier is matched and discarded. Every table here is written
 * `app.<table>`, so a pattern that stops at the dot reports `app` for every statement
 * ever logged — a constant field that looks like data. `db.collection.name` is the
 * table in OTel's vocabulary; the schema would be `db.namespace`, and with exactly one
 * schema it carries no information worth a field.
 *
 * A leading CTE is stepped over so `WITH … INSERT INTO x` reports `insert` rather than
 * `with`, which is not an operation anyone queries by.
 */
export function describeQuery(sqlQuery: string): { 'db.operation.name': string; 'db.collection.name'?: string } {
  const outer = stripParenthesized(sqlQuery.trim().replace(/\s+/g, ' '));
  const operation = /\b(select|insert|update|delete)\b/i.exec(outer)?.[1]?.toLowerCase() ?? 'other';
  const table = /\b(?:from|into|update|join)\s+"?(?:[a-z_][a-z0-9_]*"?\."?)?([a-z_][a-z0-9_]*)"?/i
    .exec(outer)?.[1]
    ?.toLowerCase();
  return table === undefined
    ? { 'db.operation.name': operation }
    : { 'db.operation.name': operation, 'db.collection.name': table };
}

/**
 * Drop every parenthesized group, innermost first, leaving only what runs at the outer
 * level. That is what makes a CTE report the statement it performs rather than `with`,
 * and keeps a subquery's table from being mistaken for the statement's own.
 */
function stripParenthesized(sql: string): string {
  let out = sql;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/\([^()]*\)/g, ' ');
  } while (out !== previous);
  return out;
}
