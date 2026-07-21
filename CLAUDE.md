# p1-platform

pnpm + Turborepo monorepo. Root commands: `pnpm build|test|lint|typecheck` (turbo-driven), `pnpm test:e2e` (Playwright vs local mock server).

## Rules

- **Worker names in wrangler configs are frozen.** DNS, GCLB routing (in pantheon-content-cloud's Terraform), and service bindings reference them. Never rename a worker.
- Supported env lanes: **local, staging, production**. sbx1/sandbox is retired — don't add it back.
- Cross-package deps inside the repo are `workspace:*`. Published packages must not depend on `apps/*` or `workers/*`.
- pnpm `overrides` in pnpm-workspace.yaml carry parity pins from the repo merge (partysocket, @puckeditor/core, scoped ajv/vite). Don't loosen them casually — each has a comment explaining why; upgrades are deliberate tasks.
- The CSS worker's typecheck/lint and css-frontend + puck-css tests have known pre-existing failures (counts in docs/migration/STATUS.md). Don't "fix" them incidentally in unrelated PRs.

## Where things came from

Merged from collaborative-state-system, puck-css-integration, p1-chatbot, p1-media-r2 (import SHAs and layout map: docs/migration/STATUS.md). Each source repo's docs, including its original CLAUDE.md, live under `docs/<repo>/`.

## Local dev pointers

- CSS backend: `make dev` (Docker Postgres) → `make worker-dev`; frontend: `make frontend-dev`.
- Chat agent: `workers/p1-agent`, `wrangler dev` on :8787-adjacent; expects CSS at localhost:8787, media at localhost:8788, secrets in `.env`.
- Media worker: `workers/p1-media`, dev port 8788 (note: css-mcp-server also defaults to 8788 — don't run both locally at once).
