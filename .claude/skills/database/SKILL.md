---
name: database
description: >-
  Query, write to, or review access to CCR's Postgres — the scoped `db()` handle from
  src/db/scope, not a connection passed as an argument. Use when adding or editing a
  query, opening a transaction, deciding between the Drizzle builder and a raw `sql`
  statement, hitting "No database scope on this call path", choosing between the
  database stub and a real Postgres for a test, adding a table or column, or setting up
  a per-worktree local database. Also use when reviewing a diff that touches queries.
---

# Database access

CCR queries through one handle, taken from the request's scope rather than passed as an
argument. `runWithConnection` opens the scope; `db()` returns the handle; `transaction()`
puts the transaction in the scope so nothing reached from it can run a statement outside.

Full reference: [docs/ccr/DATABASE.md](../../../docs/ccr/DATABASE.md). Read it before
writing a query in a file that has none; this file is the decision layer.

## Which handle

| You are | Use |
|---|---|
| Writing a query in a service, route or DO | `db()` from `src/db/scope` |
| Needing several writes to land together | `transaction()` from `src/db/scope` |
| At an entry point with no scope yet (Workflow, queue, cron, DO) | `runWithEnvConnection(env, fn)` |
| In a test | `stubDatabase()` from `tests/__stubs__/database.ts` |

Never open a `postgres` client outside `src/db/`. A connection the scope does not know
about will not join the surrounding transaction, and nothing will tell you.

`db()` throwing `NoDatabaseScopeError` means the call path reached the database without a
scope. Open one at the entry point — do not thread a handle down to the caller that
failed. Work handed to `ctx.waitUntil()` outlives the scope that scheduled it and needs
its own.

## Builder or raw SQL

The builder is the default, and `src/db/schema/` is what it takes: one file per table in
the `app` schema, re-exported from `index.ts`, rows returned in the schema's property
names.

Raw `sql` through `db().execute<Row>()` is for statements the builder has no form for —
window functions, recursive CTEs, `INSERT ... SELECT` reading the table it writes, an
`ON CONFLICT` shape the builder cannot express. Say so in a comment when you reach for
one, and then:

- **Bind each value once.** Every `${value}` is its own parameter, so a snapshot
  interpolated twice crosses the wire twice. Bind it once in a leading CTE and reference
  it by name.
- **Name the columns** in an `INSERT`, and select the ones you read rather than `SELECT *`.
- **Map the result at the boundary.** Raw rows come back in database column names.

Interpolation carries values, never fragments. A string concatenated into the SQL text is
a value that escaped binding.

## `src/db.ts` is the old API

`query()`, `withTransaction`, `setDatabaseInstance`, `getDatabaseInstance` and
`DatabaseConnection` are the pre-Drizzle surface, and their remaining callers are being
converted. Do not add one. `runWithConnection` and `runWithEnvConnection` are the
exceptions: they open the scope and they stay.

Converting the queries in a file you are already editing for another reason is welcome.
Converting a file you have no other reason to touch is its own task — say so rather than
half-converting it.

## Tests

`stubDatabase()` installs a Drizzle handle as the scope fallback, so the code under test
reaches it through `db()` with nothing mocked. Stubs are keyed by table and operation
(`database.on(organizations).select.returns([...])`), and the stub records what was
issued (`database.calls(table).select` gives `{ sql, params }`), which is how a test
asserts on a clause the return value cannot show.

What it cannot answer is whether the SQL is right. A constraint firing, a cascade
deleting, a unique index rejecting, a migration applying, the schema matching — those are
Postgres's own behaviour and belong in `workers/ccr/tests/db/**`, run by `test:db`, which
`test:all` **skips**.

`vi.mock('../../src/db')` does not stub your queries. `db()` comes from `src/db/scope`,
which that mock does not touch, so the code under test still resolves the real scope and
whatever handle sits in it. Specs mock `src/db` to neutralise `runWithConnection`; the
handle comes from `stubDatabase()`.

See the `testing` skill for tiers and commands.

## Schema changes

Edit the table's file in `src/db/schema/`, `pnpm db:generate`, review the SQL it writes
to `drizzle/`, `pnpm db:migrate`, and commit the schema change, the migration and
`drizzle/meta/` together. Never edit an applied migration — nothing detects it, and
databases that already ran it stay permanently out of step. The
[README](../../../docs/ccr/README.md#database-migrations) has the rest, including custom
migrations for triggers and the CI sync gate.

## Local database

Each worktree needs its own database. Two trees at different migration heads pointed at
one database leave it at whichever migrated last, and the other tree's suite fails on a
schema it did not write. `make db-shell`, `CREATE DATABASE <name> OWNER cssuser;`, then
migrate it with `POSTGRES_CONNECTION_STRING` pointed at the new database and run that
tree's tests with `POSTGRES_DB=<name>` — the one-shot scripts read only the former, the
test helper assembles its URL from parts.
