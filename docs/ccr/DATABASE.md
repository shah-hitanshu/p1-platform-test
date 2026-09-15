# Working with the Database

Every query CCR issues goes through one handle, and that handle comes from the request's
scope rather than from an argument or an import. This page is the contract: how a query
gets a connection, what a transaction guarantees, when raw SQL is still the right answer,
and what a test uses instead of a database.

The schema itself and the migration workflow are in the
[README](./README.md#database-migrations).

## The scope

`runWithConnection` opens a scope, and `db()` returns the handle held in it:

```ts
import { eq } from 'drizzle-orm';
import { db } from './db/scope';
import { organizations } from './db/schema';

const rows = await db()
  .select({ id: organizations.id, name: organizations.name })
  .from(organizations)
  .where(eq(organizations.id, orgId))
  .limit(1);
```

Nothing in between passes a connection down. A route handler, the service it calls and
the query that service runs all reach the same handle by calling `db()`, so a function
that needs the database says so by calling it and nothing else changes.

The scope is opened once per unit of work: `src/index.ts` wraps every request,
`runWithEnvConnection(env, fn)` does the same from bindings for the paths that have no
request — Workflows, queue consumers, crons, Durable Objects. Work handed to
`ctx.waitUntil()` outlives the scope that scheduled it and needs its own.

Outside any scope `db()` throws `NoDatabaseScopeError`. That is the signal that a call
path reached the database without opening one, and the fix is to open one at the entry
point rather than to thread a handle through.

`installDatabase` is what a test uses to make its own handle the answer outside a scope.
An open scope still wins, and an ESLint rule rejects importing it from `src/**`:
production code opens a scope.

## Transactions

`transaction()` runs its callback with the transaction in the scope:

```ts
import { transaction } from '../db/scope';

await transaction(async () => {
  await createBranch(siteId, name);
  await recordAudit('branch.create', siteId);
});
```

Every `db()` inside the callback, at any depth, returns the transaction. A participant
cannot run a statement outside it by accident, because there is no other handle to reach
for — which is the reason the handle lives in the scope rather than in a parameter.

A nested `transaction()` is a savepoint, so a helper that wants atomicity of its own
composes with a caller that already opened one. `inTransaction()` reports whether the
current handle is a transaction, for code that must behave differently inside one.

Keep a transaction to database work. An HTTP call or a Durable Object round trip inside
one holds a connection open for the length of the network, and a pool has few of them.

## Writing a query

The builder is the default. `src/db/schema/` declares every table in the `app` schema,
one file per table, re-exported from `index.ts`; the builder takes those objects, returns
rows in the property names the schema maps to, and the column list in `select()` is what
the statement asks Postgres for.

Raw SQL is legitimate where the builder has no form for the statement: window functions,
recursive CTEs, `INSERT ... SELECT` that reads the table it writes, `ON CONFLICT` shapes
the builder cannot express. Those go through ``db().execute<Row>(sql`...`)``, and
the rows come back in database column names, so the function that runs one maps them to
its own return type at the boundary.

A raw statement still owes two things.

**Bind each value once.** Every `${value}` in a `sql` template is a separate bind
parameter, so a value the statement reads three times crosses the wire three times — a
document snapshot read twice is the whole document sent twice per save. Bind it once in a
leading CTE and reference it by name:

```ts
await db().execute(sql`
  WITH incoming AS (
    SELECT ${documentId}::uuid AS document_id,
           ${snapshotJson}::jsonb AS snapshot
  )
  INSERT INTO app.document_versions (document_id, snapshot)
  SELECT incoming.document_id, incoming.snapshot FROM incoming
  WHERE NOT EXISTS (...)`);
```

**Name the columns.** List them in an `INSERT`, and select the ones you read rather than
`SELECT *`. A statement that names its columns keeps working when a column is added; one
that relies on table order stops silently.

Interpolation is how a value reaches the statement, never how a fragment does. Anything
built by concatenating a string into the SQL text is a value that escaped binding.

## What bounds a statement

Two limits apply to every statement, and neither is something query code arranges.
Postgres cancels a statement past `statement_timeout` (30s) itself; a client-side
deadline two seconds later cancels the backend for the case where the server never
answers at all, which is the Hyperdrive failure that would otherwise kill the Worker with
a 500 carrying no CORS headers.

Every statement is logged with its operation and primary table — never the statement text
or its parameters, either of which can carry customer content.

## Tests

Most tests want the stub. `stubDatabase()` from `tests/__stubs__/database.ts` builds a
Drizzle handle that answers from stubs and installs it as the scope fallback, so the code
under test reaches it through `db()` with nothing wrapped and nothing mocked:

```ts
import { stubDatabase, type DatabaseStub } from '../__stubs__/database';
import { organizations } from '../../src/db/schema';

let database: DatabaseStub;
beforeEach(() => { database = stubDatabase(); });

it('returns the organization the site belongs to', async () => {
  database.on(organizations).select.returns([{ id: 'org-1', name: 'Acme' }]);

  expect(await getOrganization('org-1')).toEqual({ id: 'org-1', name: 'Acme' });
});
```

Stubs are keyed by table and operation, so a test says what a query against a table
returns without restating the query, and adding an unrelated query to the code under test
does not disturb a test that never stubbed it — unstubbed queries return no rows.
`returnsRaw` covers projections the schema cannot describe (aggregates, aliases);
`rejects` takes the error the driver would raise and wraps it the way Drizzle does, so
code reading a SQLSTATE off `cause` runs the path it takes in production.

The stub also records what was issued: `database.calls(table).select` gives the `{ sql,
params }` of each matching statement, and `database.statements` gives every statement in
order. That is how a test asserts on a clause the return value cannot show — that a query
excludes archived rows, or orders deterministically.

What the stub cannot answer is whether the SQL is right. A constraint firing, a cascade
deleting, a unique index rejecting, a migration applying, the schema matching — those are
the database's own behaviour, and they belong in `tests/db/**` against a real Postgres.
Tests that need a live database for a different reason (two parts meeting across a real
connection) go in `tests/integration/**`.

```bash
make docker-up                          # Postgres in a container
pnpm --filter ccr-worker test           # the default tier: stub, no external process
pnpm --filter ccr-worker test:integration
pnpm --filter ccr-worker test:db
```

`test:all` runs the default suite and `test:integration` and **skips `test:db`** — run
that one yourself. Both Postgres suites pin themselves to a single worker because their
files share one schema.

Postgres-backed tests take their connection from `TEST_CONNECTION_STRING` in
`tests/helpers/database.ts`, which reads `TEST_DATABASE_URL` or
`POSTGRES_CONNECTION_STRING` whole, and otherwise assembles a URL from `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`.

### One database per worktree

Worktrees share a container but must not share a database. Two trees at different
migration heads pointed at the same database leave it at whichever one migrated last, and
the other tree's suite fails on a schema it did not write. Create a database for the tree,
migrate it from that tree's own files, and point that tree's tests at it:

```bash
make db-shell        # then: CREATE DATABASE <name> OWNER cssuser;
POSTGRES_CONNECTION_STRING=postgresql://cssuser:csspass@localhost:5432/<name> \
  pnpm --filter ccr-worker db:migrate
POSTGRES_DB=<name> pnpm --filter ccr-worker test:db
```

The two variables are not interchangeable. The one-shot scripts (`db:migrate`,
`db:baseline`, `db:seed`) read `POSTGRES_CONNECTION_STRING` and nothing else; the test
helper assembles a URL from parts, so `POSTGRES_DB` alone is enough there.

## The driver stays in the db layer

`postgres` and `drizzle-orm/postgres-js` are imported under `workers/ccr/src/db/` and
nowhere else. Services, routes and Durable Objects import `db()` and the schema. A driver
import outside that directory is a connection the scope does not know about, and it will
not participate in the surrounding transaction.

## The legacy surface

`src/db.ts` still exports the pre-Drizzle API — `query()`, `withTransaction`,
`setDatabaseInstance`, `getDatabaseInstance`, `DatabaseConnection` — and its
remaining callers are being converted. It is going away. Do not add a caller: new
work uses `db()` and `transaction()` from `src/db/scope`, and a file being touched for
another reason is the right moment to convert the queries in it.

`runWithConnection` and `runWithEnvConnection` are the exceptions. They are the scope
openers and they stay.

## See also

- [README: Database Migrations](./README.md#database-migrations) — the schema source of
  truth, `db:generate`/`db:migrate`, and the CI sync gate
- [BACKFILLS.md](./BACKFILLS.md) — one-off data conversions, which are scripts rather
  than migrations
- `workers/ccr/src/db/scope.ts` — the scope itself
- `workers/ccr/tests/__stubs__/database.ts` — the stub's full surface
