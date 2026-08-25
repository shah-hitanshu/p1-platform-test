# p1-platform

pnpm + Turborepo monorepo. Root commands: `pnpm build|test|lint|typecheck` (turbo-driven), `pnpm test:e2e` (Playwright vs local mock server).

## Rules

- **Worker names in wrangler configs are frozen.** DNS, GCLB routing (in pantheon-content-cloud's Terraform), and service bindings reference them. Never rename a worker.
- Supported env lanes: **local, staging, production**. sbx1/sandbox is retired — don't add it back.
- Cross-package deps inside the repo are `workspace:*`. Published packages must not depend on `apps/*` or `workers/*`.
- pnpm `overrides` in pnpm-workspace.yaml carry parity pins from the repo merge (partysocket, @puckeditor/core, scoped ajv/vite). Don't loosen them casually — each has a comment explaining why; upgrades are deliberate tasks.
- A pre-commit hook (`.githooks/`, wired up by `pnpm install`) runs `eslint --fix` on staged JS/TS files, so expect commits to carry autofixes it made. It never blocks on unfixable problems. Formatting is not covered and Prettier is not enforced — don't mass-reformat. See README "Pre-commit autofix".
- **Don't log with `console.*`.** Runtime code in `workers/*` and `apps/*` logs through `P1Logger` from `@pantheon-systems/p1-telemetry`; everything in `packages/*` is published and must not log at all. Tests, scripts, and CLI output are exempt. `no-console` is off in the shared ESLint config, so nothing catches a stray `console.log` for you. See the `logging` skill.
- **Worker code logs through p1Logger, never `console.*`.** Use `getLogger()` from `@pantheon-systems/p1-telemetry` (or `ensureLogger(env)` at request entry points): `getLogger().error(message, error, fields)`. Structured fields are queryable in the Cloudflare dashboard and the logger attaches request metadata (trace, route, service); `console.*` output gets neither. Existing `console.*` calls are legacy — don't add new ones. Caveat: `getLogger()` before any `ensureLogger(env)` has run silently returns an unconfigured fallback (`app: 'unknown'`, no request metadata) — that's what a log line starting `unknown` means. In-request worker code is fine (index.ts initializes first); CLI scripts, queue/DO paths outside a request, and tests are where the fallback bites.
- Production typecheck, lint, and every unit suite are green through turbo, so a red result there is yours. The one standing accommodation is `workers/ccr`'s test-only type errors, held to a committed ceiling by `pnpm check:typecheck-tests`; that count may fall, never rise.
- **Don't change or delete an existing test without being asked.** When one blocks your change, name it and say why it disagrees with you; loosening an assertion to reach green deletes the only thing that would have caught the regression. See the `testing` skill.

## Where things came from

Merged from collaborative-state-system, puck-css-integration, p1-chatbot, p1-media-r2 (import SHAs and layout map: docs/migration/STATUS.md). Each source repo's docs, including its original CLAUDE.md, live under `docs/<repo>/`.

## Local dev pointers

- CCR backend: `make dev` (Docker Postgres) → `make worker-dev`. (The CCR admin frontend was removed upstream, PCC-3158.)
- Chat agent: `workers/p1-agent`, `wrangler dev` on :8787-adjacent; expects CCR at localhost:8787, media at localhost:8788, secrets in `.env`.
- Media worker: `workers/p1-media`, dev port 8788 (note: ccr-mcp-server also defaults to 8788 — don't run both locally at once).
