# Monorepo migration status

Phase 1 (import) and Phase 2 (workspace unification + sbx1/sandbox retirement) **complete** 2026-07-21, local only — **nothing pushed**.
Plan of record: `~/pantheon/monorepo-feasibility-report.html`.

## Phase 2 completion (second pass)

- **sbx1/sandbox retirement executed:** env blocks deleted from all five wrangler configs
  (incl. the chris-801 URLs and the chatbot's unpinned-account env), `deploy:sbx1`/`deploy:sandbox`
  scripts removed, `terraform/environments/sbx1` deleted, setup/teardown-sandbox scripts deleted,
  Makefile lanes and stale comments updated. Supported lanes: local, staging, production.
  Chatbot's local `MEDIA_WORKER_URL` now points at `http://localhost:8788` (media worker in-repo).
- **Makefile + scripts/css re-pointed** at monorepo paths (`workers/collaborative-state`,
  `apps/css-frontend`, `scripts/css/*`); `sync-terraform-to-wrangler.sh` root-resolution fixed.
- **Root README.md and CLAUDE.md** written (frozen-worker-names rule, lanes, parity-pin policy).
- css-mcp-server's `wrangler-validation.spec.ts` `DEPLOYABLE_ENVS` updated to
  `['staging','production']` — all 226 mcp tests green.
- **All five workers validated** with `wrangler deploy --dry-run --env staging` (bundle + config parse).
- **Known flake:** collaborative-state-worker's suite (3,379 tests) is green standalone and
  cache-warm, but can fail under a full cold `--force` parallel run (DB-mock timing under load).
  Phase 3 CI should cap turbo `--concurrency` or vitest workers for that suite.

## Import baseline (for delta sync)

Imported via `git subtree add` with full history. To port commits landed in the source
repos after these SHAs: `git format-patch <sha>..origin/main` in the source repo, then
`git am --directory=<new path>` here (drop any pnpm-lock.yaml hunks; re-run `pnpm install`).

| Source repo | Imported SHA | Now lives at |
|---|---|---|
| collaborative-state-system | `dc72ece` | workers/collaborative-state, workers/css-mcp-server, apps/css-frontend, packages/p1-content-validator, terraform/, docker/, examples/, scripts/css |
| puck-css-integration | `8844569` | packages/{css-client,puck-css,p1-next-sdk,create-p1-starter-kit,eslint-config}, apps/p1-starter, e2e/, root tooling configs |
| p1-chatbot | `4b53e5a` | workers/p1-agent, packages/p1-ai-chat, scripts/p1-chatbot |
| p1-media-r2 | `bcabbc4` | workers/p1-media, packages/p1-media-r2, terraform/media |

Old GitHub workflows are parked under docs/migration/*-workflows/ for reference; none are active.

## Verification state (vs. each source repo at the SHAs above)

`turbo run build test lint typecheck --continue`: **35/40 tasks green.** All 5 red tasks
are failures that exist identically in the source repos (verified side by side):

| Task | Status | Upstream comparison |
|---|---|---|
| build (all 10 packages) | ✅ green | — |
| collaborative-state-worker typecheck | ❌ 2,626 errors | identical count upstream (CI runs typecheck as continue-on-error) |
| collaborative-state-worker lint | ❌ 487 problems | identical upstream |
| css-mcp-server lint | ❌ 1 error | identical upstream |
| css-frontend test | ❌ 11 failed / 267 passed | identical upstream (frontend tests are not in CSS CI) |
| puck-css test | ❌ 14 failed / 1,963 passed | identical upstream |

create-p1-starter-kit's template builder (`repoRoot = ../../..`) verified working at the
new depth; puck-css's pds-core.css copy step verified under merged hoisting.

## Deliberate deviations from the source repos

- **Resolution pins for parity** (fresh install resolved newer, breaking versions):
  `partysocket` pinned 1.1.10 (1.3.0 narrowed its Message type); `@puckeditor/core`
  pinned 0.21.1 via override (drifted to 0.21.3/0.22.2 split); `ajv` override scoped to
  `ajv@<7` (unscoped collapsed eslintrc's ajv@6 → 8, crashing ESLint); `vite` override
  scoped to `vite@^8` (unscoped force-upgraded puck-css's vite 6). Each is a candidate
  for a deliberate upgrade later.
- **uuid note:** the global `>=14` override (from puck) now also applies to the chatbot
  tree, which previously resolved uuid 9.x. Tests pass; watch for runtime surprises.
- **Package renames** (directories and generic names): `worker` → `p1-media-worker`,
  `frontend` → `css-frontend`. Worker names in wrangler configs are UNCHANGED (frozen by
  design — routing/PCC Terraform reference them).
- **React types**: css-frontend `@types/react{,-dom}` 19 → 18 (matches its React 18.2
  runtime); p1-ai-chat dev env 18 → 19 (peer range unchanged, host app runs 19).
- **eslint-config**: single package; puck superset + default export for CSS-style imports.
- **openapi.yaml colocated** into each worker (`workers/*/docs/`) — they're runtime
  assets served at /docs, not documentation.
- **packageExtensions** give `@puckeditor/core` and `@tanstack/react-query` an optional
  `@types/react` peer so mixed 18/19 type majors resolve per-consumer.
- **examples/** is now a workspace member (it wasn't in CSS); two trivial lint fixes there.

## Next steps

1. Remaining Phase 2: delete sbx1/sandbox env blocks from all wrangler configs
   (retirement), root CLAUDE.md, real README.
2. Phase 3: author .github/workflows (ci with turbo --affected, path-filtered Postgres
   suite + e2e, single changesets publish.yml, deploy-workers dispatch incl. p1-agent).
3. Phase 4 — NOTE: host is the NEW repo `pantheon-systems/p1-platform`, so unlike the
   report's keep-the-name scenario, identity work is REQUIRED before any deploy/publish:
   WIF trust for repo claim `p1-platform` (Terraform, add-before-remove) and npm
   trusted-publisher entries for all 7 packages (repo p1-platform + publish.yml).
4. Delta-sync from source repos before cutover (see import baseline above).
