# Backfills

A backfill is a one-off data conversion run against an environment's database:
moving a value to a new location, adopting new identifiers, converting a snapshot
shape. They are separate from schema migrations, which run on deploy and change
structure rather than content.

Run them from the **Run Backfill** GitHub Action, not from a laptop.

## Running one

Actions → **Run Backfill** → Run workflow:

| Field | |
|---|---|
| `environment` | `staging` or `production` |
| `script` | which backfill (the dropdown is the registry) |
| `execute` | **off** for a dry-run report, **on** to write |
| `site_id` | optional UUID, to scope the run to one site |

**Always dispatch twice.** The first run reports what would change and writes
nothing; read it, then dispatch again with `execute` to apply. The report is the
only review step a data conversion gets, and the log is the record of what
happened — which is why this does not belong in a terminal.

`site_id` is useful for a cautious first pass on production: convert one site,
look at it, then run unscoped.

### Ordering against deploys

A backfill that writes a shape only the new code understands must run **after**
that code is deployed to the environment. A backfill that only cleans up data both
old and new code can read has no ordering constraint. Say which one it is in the
script's header comment.

The workflow deliberately does not deploy anything. It is dispatched separately so
a backfill can run days after the deploy that enabled it, without pushing a new
worker version.

## Writing one

Two files and two scripts, following `src/db/backfill-page-titles.ts`:

**1. The logic, in `src/services/<name>.ts`.** Keep the decision of *what* to
change in a pure exported function so it can be unit tested without a database —
`classifyTitleBackfill` is the example. The sweep function takes
`{ siteId?, dryRun? }` and returns what it converted and what it skipped, with a
reason per skip.

**2. The runner, in `src/db/<name>.ts`.** Parses `--execute` and `--site=`, calls
the service through `runWithConnection`, and prints a summary.

**3. The script pair, in `workers/package.json`:**

```json
"db:my-backfill": "tsx src/db/my-backfill.ts",
"db:my-backfill:execute": "tsx src/db/my-backfill.ts --execute"
```

The `db:<name>` / `db:<name>:execute` pairing is what the workflow relies on — it
builds the target from the dropdown value, so the names must match exactly.

**4. Register it** by adding `<name>` to the `script` options in
`.github/workflows/run-backfill.yml`.

### Rules that are not optional

- **Dry run by default.** `--execute` opts in. A backfill that writes when run
  with no arguments is a loaded gun.
- **Idempotent.** Re-running must convert nothing the second time. Test it.
- **Append, do not rewrite.** Persist changes as new document versions via
  `createDocumentVersion`, not `UPDATE ... SET snapshot`. Most
  `document_versions` rows store a forward patch rather than a snapshot, so there
  is often nothing to edit in place, and mutating patches corrupts the chain that
  reconstruction replays. Appending also keeps the baseline/diff invariants owned
  by the version service and makes rollback a revert.
- **Only the latest version per (document, branch).** Rewriting history is neither
  possible nor wanted.
- **Report what you skipped, and why.** A count of "skipped" with no reasons hides
  the interesting cases. `backfill-page-titles` surfaces an `unreadable` bucket,
  which is how two double-encoded snapshots were found.
- **`forceNonStructural: true`** when creating the version, unless the change
  really is an authored edit. It leaves `action_type` null so a template migration
  spanning the version propagates no delta to bound pages.
- **Never interpolate anything into a shell command.** No `${{ }}` inside a
  `run:` block — not a dispatch input, not a repo variable. Pass it through `env:`
  and quote the variable, as `run-backfill.yml` does, and validate it besides
  (`site_id` is checked against a UUID pattern). A `choice` input feels safe
  because GitHub constrains it, but the safety lives in the trigger definition
  rather than in the step, and Wiz flags it as script injection either way. Routing
  through `env:` also means `set -u` catches an unset variable instead of silently
  substituting an empty string.

### Gotcha: the `createRequire` workaround

`fast-json-patch` exposes its CJS entry via `Object.assign(exports, ...)`, which
Node's ESM loader cannot bind by name. Because `workers/package.json` sets
`"type": "module"`, any script importing the version service **dies at module
load** under `tsx`:

```
SyntaxError: The requested module 'fast-json-patch' does not provide an export named 'compare'
```

Route the imports through `createRequire` instead, as `adopt-slot-ids.ts` and
`backfill-page-titles.ts` do:

```ts
const cjsRequire = createRequire(import.meta.url);
const { runWithConnection } = cjsRequire('../db') as typeof import('../db');
```

Take every binding from the same `require`, or you get two module instances and
two connection scopes.

Note this is invisible to CI: tests pass and the build is clean, because vitest
and esbuild do their own CJS interop. **Running the script is the only test that
it loads.** `db:backfill-template-content-shape` lacks this workaround and
currently cannot run at all, which is why it is not in the workflow's dropdown.

## Registered backfills

| Script | What it does |
|---|---|
| `backfill-page-titles` | Moves a legacy top-level snapshot `title` to `root.props.title`. Optional cleanup — listings read both locations, and pages self-heal when edited. |
| `adopt-slot-ids` | Matches template-bound documents' components to template slots and rewrites ids. Live editing should be quiescent during an execute run. |

`backfill-template-content-shape` exists but is unregistered: it needs the
`createRequire` fix before it can run.
