# Staged workflows (INERT — not in .github/workflows/)

Phase 3 authored these; Phase 4 activates them. They cannot run from this directory.
GitHub only executes workflows under `.github/workflows/`, so nothing here can
publish, deploy, or touch GCP until deliberately moved.

## Activation prerequisites (Phase 4 — see STATUS.md identity plan)

| Workflow | Before moving to .github/workflows/ |
|---|---|
| `publish.yml` | **ACTIVATED 2026-08-06** (moved to .github/workflows/ and split — `version-packages.yml` opens the Version PR on push to main, `publish.yml` is manual-only; process in `docs/releasing.md`). Still gated on npm trusted-publisher config for **all 7 packages** trusting repo `pantheon-systems/p1-platform` + workflow `publish.yml` (add-before-remove vs the old repos) — until those exist the publish step fails on OIDC. The filename must stay `publish.yml`. |
| `deploy-workers.yml` | **ACTIVATED 2026-07-31** (moved to .github/workflows/). WIF binding: `additional_repos += "p1-platform"` via the old repo's `terraform/bootstrap/<env>` (manual, Owner/Editor ADC — NOT deploy-infra). GitHub environments `staging`/`production` with vars: `GCP_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDSQL_INSTANCE_CONNECTION_NAME`, `CLOUDSQL_DB_NAME` (copy from old repos — media's match CSS's for staging/production). |
| `deploy-infra.yml` | Same WIF binding + environments. |
| `terraform-plan.yml` | Same WIF binding, plus repo-level vars `STAGING_/PRODUCTION_GCP_PROJECT_ID` and `STAGING_/PRODUCTION_CLOUDFLARE_ACCOUNT_ID`. Runs on PRs touching `terraform/**` — activate last, after the binding is proven, or every terraform PR fails auth. |

Validation order after activation: terraform-plan on a PR (read-only SA, proves WIF
end-to-end) → deploy-workers dry-run staging → real staging deploy → production.

## Changes vs the source-repo originals (docs/migration/*-workflows/)

- sbx1/sandbox environment options removed (lane retired).
- Paths updated: `workers` → `workers/collaborative-state`, `workers/mcp-server` →
  `workers/css-mcp-server`, `frontend` → `apps/css-frontend`, media `worker` →
  `workers/p1-media`; media installs from the workspace root now.
- deploy-workers gains two jobs: `p1-agent` (its first-ever CI deploy — runtime
  secrets already live on the worker, so only the CF token is fetched) and
  `p1-media` (absorbs the media repo's deploy-worker.yml).
- Each deploy job builds its workspace dependencies first (`turbo --filter='<pkg>^...'`)
  — the old repos relied on committed/manual dist state.
- A concurrency group queues deploys per environment (the originals had none).
- publish.yml builds all packages (was: only p1-ai-chat) — one Changesets pipeline
  for all 7, fixed group preserved via .changeset/config.json.
