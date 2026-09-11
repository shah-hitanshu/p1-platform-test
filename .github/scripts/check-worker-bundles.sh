#!/usr/bin/env bash
# Bundles every deployed worker the way `wrangler deploy` will, without
# deploying.
#
# The packer resolves every import the entry point reaches and applies the
# module rules from wrangler.jsonc on top of wrangler's own defaults, so a
# module graph that typechecks, lints and tests clean can still fail to bundle.
# Nothing else in CI runs the packer, which leaves `Deploy Workers` on main as
# the first thing that would notice.
#
# One environment per worker is enough while no env block overrides `main` or
# `rules`; the bundle is identical across them.
set -euo pipefail

WORKERS=(ccr ccr-mcp-server p1-agent p1-media)
DRY_RUN_ENV='staging'

failed=()
for worker in "${WORKERS[@]}"; do
  printf '\n=== %s ===\n' "$worker"
  outdir="$(mktemp -d)"
  if ! (cd "workers/$worker" && pnpm exec wrangler deploy --env "$DRY_RUN_ENV" --dry-run --outdir "$outdir"); then
    failed+=("$worker")
  fi
  rm -rf "$outdir"
done

if [ ${#failed[@]} -gt 0 ]; then
  printf '\nWorkers that do not bundle:\n'
  printf '  %s\n' "${failed[@]}"
  exit 1
fi

printf '\nAll workers bundle.\n'
