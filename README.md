# p1-platform

Monorepo for Pantheon's P1 platform: the collaborative state system (CSS), the Puck/CSS editor SDK, the AI chat agent, and media handling. Merged from four repos — `collaborative-state-system`, `puck-css-integration`, `p1-chatbot`, `p1-media-r2` — with full history (see [docs/migration/STATUS.md](docs/migration/STATUS.md)).

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
