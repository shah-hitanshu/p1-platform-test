#!/usr/bin/env bash
# Fails the build when the CCR Drizzle schema and its migration folder disagree.
#
# Three checks, each catching a different way the two drift apart:
#   drizzle-kit check  two migrations that collide in the journal
#   db:check-journal   an entry the migrator would skip, because it carries an
#                      older timestamp than one already applied
#   db:generate        a schema edit that never got a migration; regenerating is
#                      the only thing that catches it
#
# Needs no database: generate diffs the schema against the snapshots under
# drizzle/meta, not against a live one.
#
# Only what regenerating *added* counts as drift, so this is runnable on a
# working tree that already has migration edits in it.
#
# Usage: check-db-schema-sync.sh   (run from the repo root)
set -euo pipefail

MIGRATIONS_DIR='workers/ccr/drizzle'

pnpm --filter ccr-worker exec drizzle-kit check
pnpm --filter ccr-worker db:check-journal

before="$(git status --porcelain -- "$MIGRATIONS_DIR")"
pnpm --filter ccr-worker db:generate
after="$(git status --porcelain -- "$MIGRATIONS_DIR")"

drift="$(comm -13 <(printf '%s\n' "$before" | sort) <(printf '%s\n' "$after" | sort))"
if [ -n "$drift" ]; then
  echo "The schema has changes with no matching migration:"
  printf '%s\n' "$drift"
  echo "Run 'pnpm --filter ccr-worker db:generate' and commit the result."
  exit 1
fi
