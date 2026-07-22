# p1-platform

Monorepo for Pantheon's P1 platform: the collaborative state system (CSS), the Puck/CSS editor SDK, the AI chat agent, and media handling. Merged from four repos — `collaborative-state-system`, `puck-css-integration`, `p1-chatbot`, `p1-media-r2` — with full history (see [docs/migration/STATUS.md](docs/migration/STATUS.md)).

## TL;DR — what this repo can and can't do today

All commands run from repo root.

| Feature | Supported | Command |
|---|---|---|
| **Run the full P1 stack locally** (Postgres + CSS worker + admin frontend + starter app) | [x] | `pnpm dev:stack` (one command; starter app uses the `.env.fullstack.local` profile) |
| Run p1-starter app | [x] | `pnpm dev:starter` (:3000, needs `apps/p1-starter/.env.local`) |
| Run p1-starter against staging | [x] | `pnpm dev:starter:staging` (uses the `.env.staging.local` profile) |
| Run CSS backend (Postgres + worker) | [x] | `make dev` (:8787; or `make docker-up` + `make worker-dev`) |
| Run CSS admin frontend | [x] | `pnpm dev:css-frontend` (:5173) |
| Run chat agent worker | [x] | `pnpm dev:agent` (needs secrets in `workers/p1-agent/.env`) |
| Run media worker | [x] | `pnpm dev:media` (:8788) |
| Run MCP server | [x] | `pnpm dev:mcp` (:8788 — clashes with media, run one at a time) |
| Build / test / lint / typecheck everything | [x] | `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm typecheck` |
| e2e (starter app vs mock backend) | [x] | `pnpm test:e2e` (first run: `pnpm exec playwright install chromium`) |
| Database migrations (local) | [x] | `POSTGRES_CONNECTION_STRING=... pnpm --filter collaborative-state-worker db:migrate` |
| Create a changeset | [x] | `pnpm exec changeset` |
| Terraform plan/apply (with local GCP creds) | [x] | `make tf-plan ENV=staging` |
| CI on pull requests | [ ] | — (Phase 3: workflows not yet written) |
| Publish packages to npm | [ ] | — (Phase 4: npm trusted-publisher config still points at the old repos) |
| Deploy workers to staging/production | [ ] | — (Phase 3/4: no deploy workflows yet; GCP WIF doesn't trust this repo yet) |

Common patterns:

| Concept | Command |
|---|---|
| Full P1 stack locally (CSS with mock auth + starter app on the local backend) | `pnpm dev:stack` — brings up Postgres, then runs the CSS worker (:8787), admin frontend (:5173), and starter app (:3000) together via turbo. One-time setup: copy `apps/p1-starter/.env.fullstack.example` → `.env.fullstack.local` and fill in your local site id + token. Ctrl-C stops the servers; `make docker-down` stops Postgres |
| Run p1-starter against staging | `pnpm dev:starter:staging` — one-time setup: copy `apps/p1-starter/.env.staging.example` → `.env.staging.local` with staging site id + `CSS_API_KEY`. A profile must set every key (even blank, e.g. `NEXT_PUBLIC_CSS_AUTH_MODE=`) so values from a plain `.env.local` can't leak in |
| Ad-hoc starter env (no profile) | `pnpm dev:starter` with `apps/p1-starter/.env.local` (gitignored; copy from `.env.example`) |
| CSS admin UI against the local backend | `make dev`, then `pnpm dev:css-frontend` (mock login at :5173) |
| Chat agent against the local stack | `make dev`, then `pnpm dev:media` and `pnpm dev:agent` |
| One package's tests/build | `pnpm --filter <package-name> test` (etc.) |
| Raw wrangler command for a worker | `pnpm --filter <worker-package> exec wrangler <cmd> --env staging` |

## Layout

| Path | What it is |
|---|---|
| `workers/collaborative-state` | CSS backend Worker — API, Durable Objects, queues, Postgres |
| `workers/css-mcp-server` | Remote MCP server (OAuth) in front of the CSS backend |
| `workers/p1-agent` | AI chat agent Worker (Durable Object, AI Gateway) |
| `workers/p1-media` | Media upload/CDN Worker (R2) |
| `apps/css-frontend` | CSS admin SPA (React 18 + Vite) |
| `apps/p1-starter` | Next.js starter app; source of the `create-p1-starter-kit` template |
| `packages/*` | Published npm packages (`css-client`, `puck-css`, `p1-next-sdk`, `create-p1-starter-kit`, `p1-ai-chat`, `p1-content-validator`, `p1-media-r2`) + shared `eslint-config` |
| `e2e/` | Playwright e2e for the starter app (runs against a local mock server) |
| `terraform/` | CSS infra (GCP + Cloudflare); media infra under `terraform/media` |
| `docker/` | Local Postgres stack (`make dev`) |
| `docs/` | Per-source-repo docs (`css/`, `puck/`, `p1-chatbot/`, `p1-media/`) and migration notes |

Environments: **local, staging, production** (the sbx1/sandbox lane is retired).

## Development

```sh
pnpm install
pnpm build        # turbo run build
pnpm test         # turbo run test
pnpm lint         # turbo run lint
pnpm typecheck    # turbo run typecheck
```

CSS backend local dev (Postgres via Docker): `make dev`, then `make worker-dev` and `make frontend-dev`. See the per-package docs under `docs/` for everything else.

## Releases & deploys

Packages version via Changesets (`.changeset/`); the four Puck SDK packages are a fixed version group. Workers deploy via `wrangler deploy --env <staging|production>` — worker names are load-bearing (DNS and load-balancer routing in pantheon-content-cloud reference them) and must not change.
