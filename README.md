# p1-platform

Monorepo for Pantheon's P1 platform: the collaborative state system (CSS), the Puck/CSS editor SDK, the AI chat agent, and media handling. Merged from four repos — `collaborative-state-system`, `puck-css-integration`, `p1-chatbot`, `p1-media-r2` — with full history (see [docs/migration/STATUS.md](docs/migration/STATUS.md)).

## Getting started

### Prerequisites

| Dependency | Version | Notes |
|---|---|---|
| Node.js | **≥ 24** | enforced via `engines` |
| pnpm | **11.15.1** | pinned via `packageManager` — run `corepack enable` and the right version is used automatically |
| Podman or Docker | any recent | local Postgres for the CSS backend (`make docker-up` autodetects which you have) |
| Playwright Chromium | — | only for e2e: `pnpm exec playwright install chromium` (one-time) |
| Terraform ≥ 1.6 + gcloud | — | only for infra work under `terraform/` |

### First run

```sh
git clone git@github.com:pantheon-systems/p1-platform.git && cd p1-platform
corepack enable          # makes `pnpm` resolve to the pinned 11.15.1
pnpm install
cp .env.fullstack.example .env.fullstack.local
pnpm dev:stack
```

`pnpm dev:stack` brings up everything for local development in one command: Postgres (via podman/docker, with `.dev.vars` generated and migrations applied automatically), the CSS worker on **:8787**, and the starter app on **:3000**.

On a **fresh database**, create a site and an API token via the worker API (see `docs/css/`), then put the site id + token into `.env.fullstack.local` and restart. To develop against staging instead: `cp .env.staging.example .env.staging.local`, fill in the staging site id + `CSS_API_KEY`, and run `pnpm dev:starter:staging`.

## Scripts

All run from the repo root.

### Dev servers

| Script | What it runs |
|---|---|
| `pnpm dev:stack` | Postgres + CSS worker (:8787) + starter app (:3000) — the default day-to-day stack |
| `pnpm dev:stack:full` | everything above **plus** media worker (:8788) and chat agent (:8790); agent chat needs secrets in `workers/p1-agent/.env` |
| `pnpm dev:starter` | starter app only (:3000), against the local backend profile |
| `pnpm dev:starter:staging` | starter app against staging (`.env.staging.local` profile) |
| `pnpm dev:agent` | chat agent worker only |
| `pnpm dev:media` | media worker only (:8788) |
| `pnpm dev:mcp` | MCP server (:8788 — clashes with media; not part of `dev:stack:full`) |
| `make dev` | CSS backend only: Postgres + worker (:8787) |
| `pnpm dev:logs` | local ndjson log collector (:8799) — run in its own terminal; see [Logging](#logging) |
| `pnpm logs:tail` | live, human-readable view of `.logs/current.ndjson` |

### Verification

| Script | What it runs |
|---|---|
| `pnpm build` | `turbo run build` across all packages |
| `pnpm test` | `turbo run test` (see [STATUS.md](docs/migration/STATUS.md) for known-red suites) |
| `pnpm lint` / `pnpm typecheck` | turbo-driven, all packages |
| `pnpm test:e2e` / `pnpm test:e2e:ui` | Playwright e2e for the starter app vs a local mock server |
| `pnpm --filter <package> test` | one package's tests (same pattern for build/lint/typecheck) |
| `pnpm clean` | remove build artifacts across packages |

### Releases & infra

| Script | What it runs |
|---|---|
| `pnpm changeset` | create a changeset for a package release |
| `pnpm changeset status --verbose` | what the next release would publish, and which changesets cause it |
| `POSTGRES_CONNECTION_STRING=... pnpm --filter collaborative-state-worker db:migrate` | local DB migrations (the stack commands run this automatically) |
| `make tf-plan ENV=staging` | Terraform plan (needs local GCP creds) |
| `pnpm --filter <worker-package> exec wrangler <cmd> --env staging` | raw wrangler against a worker |

## Pre-commit autofix

`pnpm install` points `core.hooksPath` at `.githooks/`, so committing runs `eslint --fix` over **staged JS/TS files only**, then restages them. Each file is linted against its own package's `eslint.config.js`. Partially staged files (`git add -p`) keep their unstaged hunks.

The hook only fixes. Problems ESLint can't autofix are printed but don't block the commit — CI stays the hard gate, and several packages carry known pre-existing lint failures a blocking hook would make uncommittable.

The one thing that *does* block is ESLint failing to run at all (exit 2 — broken config, unresolvable plugin), because those files were never examined and would otherwise pass as if they had been.

Formatting is *not* covered: `eslint-config-prettier` disables the stylistic rules, so the hook fixes semantic issues (`prefer-const`, `no-var`, …) and leaves whitespace and quoting alone. Prettier is configured in the repo but enforced nowhere, and wiring it up is a separate decision.

Escape hatches: `git commit --no-verify` for one commit, `git config --unset core.hooksPath` to opt out until the next `pnpm install`.

## TL;DR — what this repo can and can't do today

| Feature | Supported | How |
|---|---|---|
| Full local stack, one command | [x] | `pnpm dev:stack` / `dev:stack:full` |
| Build / test / lint / typecheck / e2e | [x] | see Scripts above |
| CI on pull requests | [x] | `.github/workflows/ci.yml` — build/test/lint/e2e/Postgres; known-red parity tasks run non-blocking |
| Deploy workers to staging/production | [x] | Actions → **Deploy Workers** (`workflow_dispatch`: environment, optional migrations, dry-run). Production requires environment approval |
| Publish packages to npm | [~] | `version-packages.yml` opens the "Version Packages" PR on push to main; Actions → **Publish to npm** publishes by hand. Blocked on the npm trusted-publisher swap — the entries still point at the old repos, so publishing fails OIDC until they're added. See [docs/releasing.md](docs/releasing.md) |

## Layout

| Path | What it is |
|---|---|
| `workers/collaborative-state` | CSS backend Worker — API, Durable Objects, queues, Postgres |
| `workers/css-mcp-server` | Remote MCP server (OAuth) in front of the CSS backend |
| `workers/p1-agent` | AI chat agent Worker (Durable Object, AI Gateway) |
| `workers/p1-media` | Media upload/CDN Worker (R2) |
| `apps/p1-starter` | Next.js starter app; source of the `create-p1-starter-kit` template |
| `packages/*` | Published npm packages (`css-client`, `puck-css`, `p1-next-sdk`, `create-p1-starter-kit`, `p1-ai-chat`, `p1-content-validator`, `p1-media-r2`) + shared `eslint-config` |
| `e2e/` | Playwright e2e for the starter app (runs against a local mock server) |
| `terraform/` | CSS infra (GCP + Cloudflare); media infra under `terraform/media` |
| `docker/` | Local Postgres stack |
| `docs/` | Per-source-repo docs (`css/`, `puck/`, `p1-chatbot/`, `p1-media/`) and migration notes |

Environments: **local, staging, production** (the sbx1/sandbox lane is retired).

## Env files

The starter app is driven entirely by the root profiles (`.env.fullstack.local`, `.env.staging.local` — copy from the `.example` templates). The root scripts inject them via `dotenv-cli`, so don't create an `apps/p1-starter/.env.local` — Next would load it as a silent fallback underneath whichever profile is active. Two files stay in their packages because wrangler only reads them from beside its config: `workers/collaborative-state/.dev.vars` (auto-generated by the stack commands) and `workers/p1-agent/.env` (agent secrets).

## Logging

Workers log through `@pantheon-systems/p1-telemetry` — never `console.*` directly. It gives
you one structured JSON line per event, with `trace_id` / `request_id` / `route` picked up
automatically from AsyncLocalStorage, so a single request is traceable across workers and
into Postgres. Full usage in the [package README](packages/p1-telemetry/README.md).

Two things worth knowing before you add a log line:

- **Context fields are allow-listed and redaction can't be turned off** — including locally,
  because a local process can run against a staging or production backend. An unrecognized
  key is dropped and its *name* recorded in `context._dropped`. Add new keys via
  `allowFields`, and never put document content, prompts, or credentials in a log line.
- **Locally, run `pnpm dev:logs`** in a second terminal. Every worker then appends to
  `.logs/current.ndjson`, so `jq -c 'select(.trace_id=="…")' .logs/current.ndjson` replays
  one causal chain across all of them. Without it you still get pretty console output.

In production, lines land in Cloudflare Workers Logs, where the JSON fields are indexed and
filterable for 7 days. Getting them into Pantheon's Grafana for longer retention and
alerting is a separate transport still being worked out with PIE —
[docs/observability/PLAN.md](docs/observability/PLAN.md).

## Releases & deploys

Packages version via Changesets (`.changeset/`); the four Puck SDK packages are a fixed version group. Add a changeset in the PR that changes a package, and merging the generated "Version Packages" PR publishes it, tags it, and cuts its GitHub Release — full process and dry-run recipes in [docs/releasing.md](docs/releasing.md). Workers deploy via the **Deploy Workers** workflow (wrangler under the hood) — worker names are load-bearing (DNS and load-balancer routing in pantheon-content-cloud reference them) and must not change.
