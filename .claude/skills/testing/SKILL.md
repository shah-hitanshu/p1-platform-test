---
name: testing
description: >-
  Use when adding or changing a test, following the repo's test-first cycle from red state to
  a reviewed implementation, deciding whether a case is a unit or an integration test,
  working out what to mock or stub and what to keep real, picking the vitest or Playwright
  command that exercises a change, working out whether Docker Postgres must be running,
  diagnosing a red suite, or judging whether a passing test asserts anything. Also use
  when reviewing a diff that touches tests, and when an existing test blocks a change.
---

# Testing

Tests here are unit or integration. What the assertion is about decides which; whether the test needs a process outside its own decides the extension and the command that runs it.

vitest runs both tiers; Playwright runs the browser tests in `e2e/`. Each workspace's vitest `include` glob is authoritative, and a file it does not match is silently never run rather than reported as an error.

Two rules bind before you touch anything: tests land before the implementation, and an existing test is not yours to modify or delete without being asked.

## Test-driven development

One component at a time, from a plan already approved:

1. Write the tests from expected inputs and outputs, following the nearest existing test file.
2. Run them and confirm they fail, and that each fails for the reason you intend rather than on a missing import or a typo. Keep the output.
3. Commit the tests on their own.
4. Implement, without touching the tests.
5. Run `pnpm exec turbo run lint --filter=<workspace>` and fix everything it reports.
6. Run the tests again and confirm they pass.
7. Present for review: the test commit hash, the test output, the lint output, and a summary of the implementation.
8. On approval, commit the implementation.

Steps 7 and 8 are gates, not formalities: the implementation is not committed until the review comes back.

## Tiers

| Tier | What it is | Real | Mocked or stubbed | Extension |
|---|---|---|---|---|
| Unit | One module's behaviour, in its own process | The module and anything pure it calls | Every collaborator you do not own | `.test.*` |
| Integration | Two or more parts meeting, or anything needing Postgres, a browser, or a server | Every part either side of the seam | Only what sits outside the seam | `.test.*` or `.spec.*` |

`.spec.*` always means integration. `.test.*` does not always mean unit: an integration test whose database is mocked runs in its own process and is named `.test.*`. A route handler driven through six modules with `vi.mock('../../src/db')` is one of those.

## Choosing one

The tier follows the assertion.

| The assertion is about | Tier | Needs |
|---|---|---|
| A computation: given this input, the function returns that | Unit | nothing |
| Composition: the route calls the service with the right arguments, middleware rejects, an error maps to a 409, our code opens one transaction | Integration | nothing |
| A real dependency's own behaviour: a constraint fires, a migration applies, a cascade deletes, a unique index rejects, the schema matches | Integration | Postgres |
| A user getting through a flow in a browser | Integration | Playwright |

Prefer the cheapest tier that answers the question; never a cheaper tier that cannot.

## Placing and naming

Directories separate tests by what they need to run, not by tier: unit and integration sit together in a workspace's `tests/` or `src/__tests__/`. Only the Postgres-backed ones go in `workers/ccr/tests/{integration,db}/`, and Playwright's in the root `e2e/`. That directory name is about Postgres rather than the tier, so an integration test with a mocked database stays in the workspace's `tests/`. Follow the nearest existing file.

Read that workspace's vitest `include` glob before adding a file. Extension use is not uniform across the repo: some workspaces name everything `.spec.*` regardless of what it needs, and `workers/ccr` keys on the directory rather than the extension. The glob is what decides whether your file runs at all, so take it from the config rather than inferring it from a neighbour in another workspace.

## Running them

Test tasks are npm scripts, so a workspace's `package.json` is the current list. Reach one with `pnpm --filter <pkg> <task>`, where `<pkg>` is the `name` field rather than the directory: `workers/ccr` publishes as `ccr-worker`. These are the tasks worth knowing by name:

| Task | Runs | Needs |
|---|---|---|
| root `test` | every workspace's `test` through turbo: everything that needs no external process | nothing |
| a workspace's `test` | that workspace alone. Takes a path to narrow to one file while iterating | nothing |
| `ccr`'s `test:integration` | its `tests/integration/**` | Postgres |
| `ccr`'s `test:db` | its `tests/db/**`, schema assertions against `information_schema` | Postgres |
| root `test:e2e` | Playwright over `e2e/`, starting the starter app against a mock CCR server | a Playwright browser installed |

`ccr`'s `test:all` covers its default suite plus `test:integration` and **skips `test:db`**; run that one yourself. Both Postgres tasks pin themselves to a single worker because their files share one schema, so parallelising them is not available as a speedup.

Postgres runs in a container, reached through the `Makefile`. Run `make` with no target for the current list with descriptions; you want the targets that start the container, migrate the schema, and open a shell. Go through those rather than a host `psql` or a raw `docker exec`: they autodetect docker or podman, and they keep the connection details in one place instead of copied into whatever is being written.

## Writing a test

- **Name one behaviour** in the `it(...)` string, in terms a reader who has not seen the implementation would recognise. Describe the invariant, not the bug or ticket that prompted it.
- **Mock or stub only at a boundary you do not own**: database, network, clock, filesystem, another service. Mocking a module you wrote and are testing through leaves you asserting on your own stub.
- **Assert observable behaviour through the public interface.** A test whose only assertion is `expect(mock).toHaveBeenCalledWith(...)` fails on any refactor that preserves behaviour.
- **One reason to fail.** If an unrelated module can redden it, the scope was drawn too wide and the failure will not say where to look.
- **Deterministic and order-independent.** No shared mutable state, no wall-clock dependence, no reliance on an earlier test having run.

### Helpers

`workers/ccr/tests/helpers/` and `e2e/helpers/` hold the shared setup for their suites. Read them before writing your own setup or teardown. Following the nearest existing file is right for structure, but that file is usually a copy of its own neighbour, so imitating it inherits that lineage's mistakes instead of the fix that landed in the helper.

Traps:

- **`packages/puck-css` aliases `@puckeditor/core` to a hand-written stub** with no store, no fields slice, no `resolveFields`. Every test in the unit project that touches Puck exercises that stub. Anything asserting Puck's own behaviour belongs in `tests-puck/`, which drops the alias. See [spike/pcc-3406/FINDINGS.md](../../../packages/puck-css/spike/pcc-3406/FINDINGS.md).
- **`@pantheon-systems/pds-toolkit-react` is stubbed too**, in `packages/puck-css` and `apps/p1-starter`.
- **`globals: false` disables Testing Library's automatic cleanup**, and many vitest configs here set it. Where yours does, call `cleanup()` yourself, or rendered DOM stays mounted for the next test in the file.
- No workspace enforces a coverage threshold and CI runs no coverage step. Where a `test:coverage` task exists it reports; nothing gates on it.
- In `workers/`, never `import` from `@cloudflare/workers-types`. Those types are ambient globals, and importing the package loads a duplicate 15k-line type universe that hangs tsc for minutes. An ESLint rule catches it. `cloudflare:workers` is fine.

## Reading a result

- **What is accepted as red.** `workers/ccr` carries test-only type errors at a committed ceiling, held by the root `check:typecheck-tests` task ([scripts/typecheck-tests-ratchet.ts](../../../scripts/typecheck-tests-ratchet.ts) names its baseline); the count may fall, never rise. Nothing else is soft-gated: no `known-issues` job, no `continue-on-error`. The red rows in `docs/migration/STATUS.md`'s verification table record parity with each source repo at the SHAs it names, not the state of this tree. Measure before inheriting a known-red claim as an excuse.

## Hard boundaries

**Do not modify or delete an existing test without explicit permission.** Stated in [docs/ccr/CLAUDE.md](../../../docs/ccr/CLAUDE.md) and [docs/puck/CLAUDE.md](../../../docs/puck/CLAUDE.md), and absolute. When a test blocks your change, name it and say why it disagrees with you. Loosening an assertion to get green deletes the only thing that would have caught the regression.
