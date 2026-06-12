# Collaborative State System

A collaborative JSON state versioning system with git-like branching, real-time CRDT-based editing, and conflict resolution. Built on Cloudflare Workers with Durable Objects for real-time collaboration and PostgreSQL for version control.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development](#development)
  - [Running Locally](#running-locally)
  - [Testing](#testing)
  - [Database Migrations](#database-migrations)
  - [Linting and Type Checking](#linting-and-type-checking)
- [Agent Registration and MCP Server](#agent-registration-and-mcp-server)
- [API Reference](#api-reference)
- [Infrastructure](#infrastructure)
  - [Docker Services](#docker-services)
  - [Terraform](#terraform)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

---

## Overview

The Collaborative State System provides:

- **Document storage** with path-based organization within sites
- **Git-like branching** with explicit create/merge operations
- **Real-time collaboration** via CRDT (Yjs) within documents
- **Conflict detection and resolution** for merge operations
- **Branch-level authorization** for access control
- **Site structures** with hierarchical navigation and metadata schemas

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Site** | A scoped collection corresponding to a Pantheon website |
| **Branch** | A named line of work; `main` represents the published state |
| **Document** | A JSON object identified by path (e.g., `pages/home`) |
| **Checkpoint** | A named snapshot of branch state for rollback/reference |
| **Structure** | Hierarchical organization of documents for navigation |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Client Applications                             │
│                    (Admin UI, Puck Editor, etc.)                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Cloudflare Workers (API)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  REST API   │  │  WebSocket  │  │    Auth     │  │   Audit     │    │
│  │   Routes    │  │   Handler   │  │ Middleware  │  │  Emitter    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────────────────────────────────────────┐
│   PostgreSQL    │  │              Durable Objects                        │
│   (CloudSQL)    │  │  ┌─────────────────┐  ┌───────────────────────┐    │
│                 │  │  │ DocumentSession │  │   PresenceManager     │    │
│  • Sites        │  │  │ (CRDT State)    │  │   (User Tracking)     │    │
│  • Branches     │  │  └─────────────────┘  └───────────────────────┘    │
│  • Documents    │  │                                                     │
│  • Versions     │  │  Real-time collaboration via Yjs CRDTs              │
│  • Checkpoints  │  │  WebSocket connections for live updates             │
└─────────────────┘  └─────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| API Server | Cloudflare Workers | HTTP API, request routing |
| Real-time Sessions | Cloudflare Durable Objects | CRDT state, WebSocket connections |
| Primary Database | PostgreSQL (CloudSQL) | Version control, metadata |
| CRDT Library | Yjs | Conflict-free collaborative editing |
| Package Manager | pnpm | Fast, disk-efficient package management |

---

## Project Structure

```
collaborative-state-system/
├── Makefile                          # Primary task runner
├── README.md                         # This file
├── PROGRESS.md                       # Implementation progress tracker
├── CLAUDE.md                         # AI assistant instructions
│
├── workers/                          # Cloudflare Workers application
│   ├── package.json                  # Node dependencies
│   ├── wrangler.jsonc                # Cloudflare Worker config (CSS API)
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── vitest.config.ts              # Unit test configuration
│   ├── vitest.integration.config.ts  # Integration test configuration
│   ├── eslint.config.js              # ESLint configuration
│   ├── .dev.vars                     # Local secrets (gitignored)
│   ├── mock-identity.config.json     # Test users/agents config
│   │
│   ├── auth-server/                  # OAuth 2.0 Authorization Server (PKCE + Google OIDC proxy)
│   │   ├── package.json
│   │   ├── wrangler.jsonc            # Auth server Worker config
│   │   ├── .dev.vars.example         # Required secrets template
│   │   └── src/
│   │       ├── index.ts              # OAuthProvider entry point
│   │       ├── auth/
│   │       │   ├── google-handler.ts # Google OAuth code exchange
│   │       │   └── origin-validator.ts # redirect_uri allowlist matching
│   │       └── services/
│   │           └── site-lookup.ts    # Service-binding call to CSS API
│   │
│   ├── mcp-server/                   # Remote MCP server (OAuth 2.0 for AI agents)
│   │   ├── package.json
│   │   └── wrangler.jsonc            # MCP server Worker config
│   │
│   ├── src/
│   │   ├── index.ts                  # Entry point
│   │   ├── types.ts                  # TypeScript type definitions
│   │   ├── db.ts                     # Database connection
│   │   │
│   │   ├── auth/                     # Authentication & authorization
│   │   │   ├── mock-identity-provider.ts
│   │   │   ├── roles.ts
│   │   │   ├── authorization.ts
│   │   │   ├── middleware.ts
│   │   │   └── guest-access.ts
│   │   │
│   │   ├── routes/                   # API route handlers
│   │   │   ├── site-api.ts
│   │   │   ├── branch-api.ts
│   │   │   ├── document-api.ts
│   │   │   ├── checkpoint-api.ts
│   │   │   ├── merge-api.ts
│   │   │   ├── grant-api.ts
│   │   │   ├── structure-api.ts
│   │   │   ├── node-api.ts
│   │   │   ├── metadata-api.ts
│   │   │   └── realtime-api.ts
│   │   │
│   │   ├── services/                 # Business logic
│   │   │   ├── site-service.ts
│   │   │   ├── document-service.ts
│   │   │   ├── branch-service.ts
│   │   │   ├── checkpoint-service.ts
│   │   │   ├── document-version-service.ts
│   │   │   ├── merge-request-service.ts
│   │   │   ├── merge-base-service.ts
│   │   │   ├── conflict-detection-service.ts
│   │   │   ├── conflict-resolution-service.ts
│   │   │   ├── crdt-merge-service.ts
│   │   │   ├── merge-execution-service.ts
│   │   │   ├── structure-service.ts
│   │   │   ├── metadata-service.ts
│   │   │   └── grant-service.ts
│   │   │
│   │   ├── durable-objects/          # Cloudflare Durable Objects
│   │   │   ├── document-session.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── audit/                    # Audit event emission
│   │   │   └── emitter.ts
│   │   │
│   │   └── db/                       # Database utilities
│   │       ├── migrate.ts            # Migration runner
│   │       └── migrations/           # SQL migration files
│   │           ├── 001_core_schema.sql
│   │           ├── 002_checkpoints.sql
│   │           ├── 003_merge_requests.sql
│   │           ├── 004_authorization.sql
│   │           ├── 005_site_structures.sql
│   │           ├── 006_seed_data.sql
│   │           ├── 007_branch_scoped_structures.sql
│   │           └── 008_document_soft_delete.sql
│   │
│   └── tests/                        # Test files (mirrors src/)
│
├── terraform/                        # Infrastructure as Code
│   ├── environments/
│   │   ├── local/                    # Local development config
│   │   └── sbx1/                     # Sandbox environment
│   └── modules/
│       ├── database/                 # PostgreSQL/CloudSQL module
│       ├── cloudflare/               # KV, Queue, Hyperdrive for CSS API worker
│       ├── cloudflare-mcp/           # KV for MCP server worker
│       └── cloudflare-auth-server/   # KV for OAuth 2.0 auth server worker
│
├── docker/                           # Docker configuration
│   ├── docker-compose.local.yaml     # Local services
│   └── init-scripts/
│       └── 01-init.sql               # PostgreSQL initialization
│
├── scripts/                          # Utility scripts
│   ├── wait-for-services.sh          # Health check script
│   └── generate-dev-vars.sh          # Local secrets generator
│
├── docs/                             # Additional documentation
│   └── MONITORING-PLAN.md
│
└── proposals/                        # Architecture proposals
    └── PROPOSAL-001-missing-api-endpoints.md
```

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|--------------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| pnpm | 8+ | `npm install -g pnpm` |
| Docker or Podman | Latest | [docker.com](https://www.docker.com/) / [podman.io](https://podman.io/) |
| Terraform | 1.6+ | [terraform.io](https://www.terraform.io/) |

Either Docker or Podman can be used as the container runtime. The Makefile auto-detects which is available (preferring Podman if both are installed). To override, set `CONTAINER_ENGINE` and `COMPOSE_CMD`:

```bash
# Force Docker even if Podman is installed
make docker-up CONTAINER_ENGINE=docker COMPOSE_CMD="docker compose"
```

Verify installation:
```bash
make version
```

---

## Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd collaborative-state-system
make worker-install
```

### 2. Generate Local Secrets

```bash
make worker-generate-secrets
```

This creates `workers/.dev.vars` with mock credentials for local development.

### 3. Start Local Development

```bash
# Start everything (Docker + Miniflare)
make dev

# Or start components separately:
make docker-up      # Start PostgreSQL and Firestore emulator
make worker-dev     # Start Miniflare (in another terminal)
```

### 4. Run Database Migrations

```bash
cd workers
pnpm db:migrate
```

### 5. Verify Services

```bash
make dev-status
```

Expected output:
```
Docker Containers:
  css-postgres   running (healthy)
  css-firestore  running (healthy)

Service Endpoints:
  PostgreSQL:  localhost:5432
  Firestore:   localhost:8080
  Worker:      localhost:8787 (when running)
```

### 6. Test the API

```bash
curl http://localhost:8787/health
```

Expected response:
```json
{
  "status": "healthy",
  "environment": "local",
  "timestamp": "2026-01-24T...",
  "database": {
    "connected": true,
    "latencyMs": 12
  }
}
```

---

## Development

### Running Locally

#### Full Stack (Recommended)
```bash
make dev
```
This starts Docker services and the Cloudflare Worker with Miniflare.

#### Docker Services Only
```bash
make dev-docker-only
```
Use when you want to run tests without starting the worker.

#### Worker Only
```bash
make worker-dev
```
Assumes Docker services are already running.

### Testing

The project uses Vitest for testing with two configurations:

#### Unit Tests
```bash
cd workers
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
```

#### Integration Tests
Integration tests require running Docker services:
```bash
make docker-up
cd workers
pnpm test:integration
```

#### All Tests
```bash
cd workers
pnpm test:all
```

#### Type Checking Tests
```bash
cd workers
pnpm test:typecheck
```

### Database Migrations

Migrations are managed with a lightweight TypeScript runner.

```bash
cd workers

# Run pending migrations
pnpm db:migrate

# Check migration status
pnpm db:migrate:status

# Reset database (WARNING: destroys data)
pnpm db:migrate:reset
```

#### Creating a New Migration

1. Create a new SQL file in `workers/src/db/migrations/`
2. Name it with the next sequence number: `009_your_migration.sql`
3. Run `pnpm db:migrate`

### Linting and Type Checking

```bash
cd workers

# Run linting
pnpm lint

# Auto-fix lint issues
pnpm lint:fix

# Type check (no emit)
pnpm typecheck
```

---

## Agent Registration and MCP Server

The system supports AI agents that authenticate with API keys and follow the Agent Politeness protocol to safely edit documents alongside human users.

### Registering an Agent

1. **Navigate to the Agents page** at http://localhost:5173/agents
2. **Click "+ Register agent"** and provide a name and description
3. **Generate an API key** by expanding the agent row and clicking "Generate key"
4. **Copy the key immediately** -- it starts with `aak_` and is shown only once
5. **Grant site access** on the site's detail page under "Agent Access" (roles: viewer, editor, or admin)

### Connecting the MCP Server

The MCP server in `examples/collaborative-state-mcp/` enables Claude Desktop or Claude Code to use the agent's credentials to read and edit documents.

```bash
cd examples/collaborative-state-mcp
pnpm install && pnpm build
cp .env.example .env
# Edit .env with your AGENT_ID and AGENT_API_KEY
```

**Claude Code:**
```bash
claude mcp add collaborative-state \
  node /path/to/examples/collaborative-state-mcp/dist/index.js \
  -e WORKER_API_URL=http://localhost:8787 \
  -e AGENT_ID=<your-agent-id> \
  -e AGENT_API_KEY=<your-aak_key>
```

**Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "collaborative-state": {
      "command": "node",
      "args": ["/path/to/examples/collaborative-state-mcp/dist/index.js"],
      "env": {
        "WORKER_API_URL": "http://localhost:8787",
        "AGENT_ID": "<your-agent-id>",
        "AGENT_API_KEY": "<your-aak_key>"
      }
    }
  }
}
```

**Local dev shortcut:** The backend ships with a mock agent (`test-agent-key-zappy`) that works without registration. See `.env.example` for pre-configured values.

For the full guide including curl-based registration, role mapping, troubleshooting, and the edit workflow, see [`examples/collaborative-state-mcp/README.md`](examples/collaborative-state-mcp/README.md).

---

## CSS Auth Server (OAuth 2.0 for Consuming Sites)

The CSS Auth Server (`workers/auth-server/`) is a standalone Cloudflare Worker that acts as an OAuth 2.0 Authorization Server for puck-css frontend clients. It proxies Google OIDC so consuming sites never need their own Google Client ID — they authenticate only against the CSS Auth Server.

### How It Works

1. A puck-css client starts an Authorization Code + PKCE flow using `client_id = <site_id>`
2. The auth server looks up the site's `allowedOrigins[]` from the CSS API via a service binding and validates the `redirect_uri`
3. The user is redirected to Google for authentication; the auth server exchanges the code for a token
4. The auth server issues a CSS-signed opaque token (`userId:grantId:secret`) to the client
5. The client sends that token as a `Bearer` token to the CSS API, which validates it via the `CSS_AUTH_SERVER` service binding

### Site Configuration

Sites must declare which origins are allowed to receive OAuth redirects. Set `allowedOrigins` when creating or updating a site:

```bash
# Create a site with allowed origins
curl -X POST http://localhost:8787/api/sites \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Site",
    "allowedOrigins": [
      "https://mysite.example.com",
      "https://*.pantheonsite.io",
      "http://localhost:3000"
    ]
  }'

# Update allowed origins on an existing site
curl -X PATCH http://localhost:8787/api/sites/<siteId> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"allowedOrigins": ["https://mysite.example.com"]}'
```

Wildcard patterns (`*`) match a single URL label (e.g. `https://*.pantheonsite.io` matches `https://dev-mysite.pantheonsite.io` but not `https://a.b.pantheonsite.io`). Wildcards are operator-controlled — clients cannot self-register.

### OAuth Discovery

The auth server exposes standard OAuth 2.0 discovery at:
```
GET https://css-auth-server-<env>.workers.dev/.well-known/oauth-authorization-server
```

### Local Development

The CSS Auth Server is not included in the standard local dev stack — puck-css clients in local development use the mock identity provider in `workers/src/index.ts`. To test the auth flow locally, run the auth server with Wrangler:

```bash
cd workers/auth-server
cp .dev.vars.example .dev.vars
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, INTERNAL_SECRET
pnpm wrangler dev
```

The main CSS worker must have `CSS_AUTH_SERVER` pointing at the local auth server instance (set `CSS_AUTH_SERVER_URL` in `workers/.dev.vars`).

---

## API Reference

### REST Endpoints

#### Sites
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites` | Create site |
| GET | `/api/sites` | List sites |
| GET | `/api/sites/{siteId}` | Get site |
| PATCH | `/api/sites/{siteId}` | Update site |
| DELETE | `/api/sites/{siteId}` | Delete site |

#### Branches
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites/{siteId}/branches` | Create branch |
| GET | `/api/sites/{siteId}/branches` | List branches |
| GET | `/api/sites/{siteId}/branches/{branchId}` | Get branch |
| PATCH | `/api/sites/{siteId}/branches/{branchId}` | Update branch |
| DELETE | `/api/sites/{siteId}/branches/{branchId}` | Delete branch |

#### Documents
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites/{siteId}/documents` | Create document |
| GET | `/api/sites/{siteId}/documents` | List documents |
| GET | `/api/sites/{siteId}/documents/{documentId}` | Get document |
| GET | `/api/sites/{siteId}/documents/by-path/{path}` | Get by path |
| PATCH | `/api/sites/{siteId}/documents/{documentId}` | Update path |
| DELETE | `/api/sites/{siteId}/documents/{documentId}` | Archive document |
| POST | `/api/sites/{siteId}/documents/{documentId}/restore` | Restore |

#### Real-Time Collaboration
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sites/{siteId}/branches/{branchId}/documents/{path}` | Get document state |
| POST | `/api/sites/{siteId}/branches/{branchId}/documents/{path}/edits` | Apply edits |
| WebSocket | `/api/sites/{siteId}/branches/{branchId}/documents/{path}/connect` | Real-time sync |

#### Checkpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites/{siteId}/branches/{branchId}/checkpoints` | Create checkpoint |
| GET | `/api/sites/{siteId}/branches/{branchId}/checkpoints` | List checkpoints |
| GET | `/api/sites/{siteId}/checkpoints/{checkpointId}` | Get checkpoint |
| GET | `/api/sites/{siteId}/checkpoints/{checkpointId}/documents` | Get documents at checkpoint |
| POST | `/api/sites/{siteId}/branches/{branchId}/checkpoints/{id}/revert` | Revert to checkpoint |
| DELETE | `/api/sites/{siteId}/checkpoints/{checkpointId}` | Delete checkpoint |

#### Merge Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites/{siteId}/merge/check` | Check mergeability |
| POST | `/api/sites/{siteId}/merge/preview` | Preview merge |
| POST | `/api/sites/{siteId}/merge/execute` | Execute merge |
| POST | `/api/sites/{siteId}/merge-requests` | Create merge request |
| GET | `/api/sites/{siteId}/merge-requests` | List merge requests |
| GET | `/api/sites/{siteId}/merge-requests/{requestId}` | Get merge request |
| PATCH | `/api/sites/{siteId}/merge-requests/{requestId}` | Update merge request |
| DELETE | `/api/sites/{siteId}/merge-requests/{requestId}` | Delete merge request |

#### Structures & Navigation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites/{siteId}/branches/{branchId}/structures` | Create structure |
| GET | `/api/sites/{siteId}/branches/{branchId}/structures` | List structures |
| GET | `/api/sites/{siteId}/branches/{branchId}/structures/{id}` | Get structure |
| PATCH | `/api/sites/{siteId}/branches/{branchId}/structures/{id}` | Update structure |
| DELETE | `/api/sites/{siteId}/branches/{branchId}/structures/{id}` | Delete structure |
| GET | `/api/sites/{siteId}/branches/{branchId}/structures/{id}/navigation` | Get navigation tree |

#### Structure Nodes
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `.../structures/{structureId}/nodes` | Create node |
| GET | `.../structures/{structureId}/nodes` | List nodes |
| GET | `.../structures/{structureId}/nodes/{nodeId}` | Get node |
| PATCH | `.../structures/{structureId}/nodes/{nodeId}` | Update node |
| DELETE | `.../structures/{structureId}/nodes/{nodeId}` | Delete node |
| POST | `.../structures/{structureId}/nodes/{nodeId}/move` | Move node |
| POST | `.../structures/{structureId}/nodes/reorder` | Reorder nodes |

#### Document Metadata
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `.../structures/{id}/state` | Get structure state |
| PUT | `.../structures/{id}/schema` | Update metadata schema |
| POST | `.../structures/{id}/validate` | Validate all documents |
| GET | `.../structures/{id}/metadata` | List document metadata |
| GET | `.../structures/{id}/documents/{docId}/metadata` | Get metadata |
| PUT | `.../structures/{id}/documents/{docId}/metadata` | Set metadata |
| DELETE | `.../structures/{id}/documents/{docId}/metadata` | Delete metadata |

#### Branch Grants
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sites/{siteId}/branches/{branchId}/grants` | Create grant |
| GET | `/api/sites/{siteId}/branches/{branchId}/grants` | List grants |
| GET | `/api/sites/{siteId}/branches/{branchId}/grants/{grantId}` | Get grant |
| DELETE | `/api/sites/{siteId}/branches/{branchId}/grants/{grantId}` | Delete grant |

---

## Infrastructure

### Docker Services

Local development uses Docker Compose (or Podman Compose) for PostgreSQL.

```bash
# Start containers
make docker-up

# Stop containers
make docker-down

# Restart containers
make docker-restart

# View logs
make docker-logs
make docker-logs-postgres
make docker-logs-firestore

# Remove containers and volumes (destroys data)
make docker-clean
```

#### Service Endpoints (Local)

| Service | Port | Connection String |
|---------|------|-------------------|
| PostgreSQL | 5432 | `postgresql://cssuser:csspass@localhost:5432/cssdb` |
| Firestore Emulator | 8080 | `http://localhost:8080` |
| Miniflare Worker | 8787 | `http://localhost:8787` |

#### Database Shell

```bash
make db-shell
```

### Terraform

Infrastructure is managed with Terraform modules.

```bash
# Initialize (ENV=local or sbx1)
make tf-init ENV=local

# Plan changes
make tf-plan ENV=local

# Apply changes
make tf-apply ENV=local

# Format Terraform files
make tf-fmt

# Validate configuration
make tf-validate ENV=local
```

| Environment | Backend | Purpose |
|-------------|---------|---------|
| `local` | None (`-backend=false`) | Local development |
| `sbx1` | GCS | Sandbox testing |
| `production` | GCS | Production deployment |

---

## Configuration

### Environment Variables

Configuration is managed through `workers/.dev.vars` (local) or Cloudflare secrets (production).

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Environment name | `local` |
| `LOG_LEVEL` | Logging verbosity | `debug` |
| `POSTGRES_CONNECTION_STRING` | Database connection | See `.dev.vars` |
| `MOCK_JWT_SECRET` | JWT signing secret (dev only) | Generated |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:*` |

### Wrangler Configuration

`workers/wrangler.jsonc` defines:

- **Durable Objects**: `DocumentState`, `PresenceManager`, `SessionManager`
- **KV Namespaces**: `CONFIG_KV`, `SESSION_KV`
- **Service Bindings**: `CSS_AUTH_SERVER` (auth server worker, for token validation)
- **Environment overrides**: `sbx1`, `production`

### Mock Identity Configuration

The mock identity provider is configured in `workers/src/index.ts` via `DEFAULT_MOCK_CONFIG`. This defines test users and agents for local development:

```typescript
const DEFAULT_MOCK_CONFIG = {
  users: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'alice@example.com',
      name: 'Alice Developer',
      siteRoles: {
        'site-123': 'admin',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin', // Real site ID
      },
    },
    // ... more users
  ],
  agents: [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      name: 'Zappy AI Assistant',
      apiKey: 'test-agent-key-zappy',
      siteRoles: {
        'site-123': 'editor',
        'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22': 'admin', // Real site ID
      },
    },
    // ... more agents
  ],
};
```

#### Adding New Sites for Local Development

When testing with a new site, you must add the site's UUID to the `siteRoles` for each mock user/agent that needs access:

1. Get your site ID from the database or API
2. Edit `workers/src/index.ts` and add the site ID to `siteRoles` for relevant users/agents
3. Restart the backend: `cd workers && pnpm dev`
4. **Important**: Log out and log back in to get a new JWT token with updated site roles

Without the site ID in `siteRoles`, presence and other authorization-protected endpoints will return 403 Forbidden.

#### Available Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access (read, write, delete, manage) |
| `developer` | Read and write access |
| `editor` | Read and write access |
| `team_member` | Read access with limited write |
| `viewer` | Read-only access |

---

## Deployment

The system deploys three Cloudflare Workers. OAuth and broker authentication are inlined in the API worker (`workers/src/auth/`) — there is no separate auth-server deployment.

| Worker | Production name | Deploy from |
|--------|----------------|-------------|
| API, realtime, broker auth | `collaborative-state-worker-production` | `workers/` |
| Frontend SPA | `collaborative-state-frontend-production` | `frontend/` |
| Remote MCP server | `css-mcp-server-production` | `workers/mcp-server/` |

### Standard deploy (existing environments)

```bash
cd workers && pnpm deploy:production            # API worker (--env production)
cd frontend && pnpm deploy:production           # Frontend SPA
cd workers/mcp-server && pnpm wrangler deploy --env production
```

In CI, trigger the **Deploy Workers** GitHub Action (`workflow_dispatch`), choose the environment, and optionally enable migrations — it builds and deploys the API and frontend, running DB migrations through the Cloud SQL Auth Proxy when requested.

### First-time production rollout (runbook)

Standing up a fresh production Cloudflare account and GCP project. Run in order.

**1. GCP foundation (one-time, local).** The CI service account does not exist yet, so bootstrap with your own GCP credentials:

```bash
cd terraform/bootstrap/production
terraform init
terraform apply
```

Each environment has its own directory under `terraform/bootstrap/` with its GCS backend and target project pinned in code, so `init`/`apply` take no `-backend-config` or `-var` flags. Bootstrap provisions two CI service accounts, split by privilege: an admin **apply SA** (`wif_service_account` output) for the main-gated deploy workflows, and a read-only **plan SA** (`wif_plan_service_account` output, project `roles/viewer`) for the PR plan job. Record both outputs; the provider URL is supplied by the shared `common-gh/auth-wif` action. For production, this bootstrap also enables the Cloud KMS API and grants the apply SA `roles/cloudkms.admin` so it can apply the broker KMS module.

**2. GitHub Actions variables.**

Repository variables, read by the `Terraform Plan` job. It runs on any same-repo PR with no environment, authenticating as the read-only plan SA (`css-github-actions-plan@<project>`), and reads the Cloudflare token from Secret Manager, so it needs no GitHub secrets:

- `STAGING_GCP_PROJECT_ID`, `PRODUCTION_GCP_PROJECT_ID`
- `STAGING_CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_CLOUDFLARE_ACCOUNT_ID`

Protected `production` (and `staging`) environment, created with required reviewers and used by the deploy workflows as the admin apply SA. Set:

- **vars:** `GCP_SERVICE_ACCOUNT` (apply SA), `GCP_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDSQL_INSTANCE_CONNECTION_NAME`, `CLOUDSQL_DB_NAME`
- **secrets:** `CLOUDFLARE_API_TOKEN`

**3. Provision infrastructure.** Run the **Deploy Infrastructure** Action → `production` / `plan`, review, then re-run with `apply`. This creates CloudSQL (HA, backups, PITR), KV ×3, Queues ×2, R2 ×2, Hyperdrive ×2, the MCP OAuth KV, and the broker KMS key ring + MAC key (granting the `p1-backend` SA signer access). `p1-backend` must already exist; create it once with `gcloud iam service-accounts create p1-backend --project=pantheon-content-cloud`. From `terraform output`, read the instance connection name and database name (backfill the step-2 vars), plus `kms_key_resource` and `signer_sa_email` (used in step 6).

**4. Wire resource IDs into the wrangler configs.**

```bash
make tf-sync ENV=production   # patches the REPLACE_WITH_PROD_*_ID placeholders
```

Then replace the remaining placeholders by hand — `REPLACE_WITH_PROD_*_ORIGIN` (custom-domain origins) in `workers/wrangler.jsonc`, `workers/mcp-server/wrangler.jsonc`, and `frontend/wrangler.jsonc`; `REPLACE_WITH_PROD_AUTH0_*` in `frontend/wrangler.jsonc`; and `REPLACE_WITH_PROD_AUTH0_CLIENT_ID` in `workers/wrangler.jsonc`.

**5. Custom domains + DNS.** In the prod Cloudflare account, attach Worker custom domains for the frontend, API, and MCP workers on your zone and add the matching DNS records. Add the frontend and API origins as allowed callback/redirect URIs on the prod Auth0 application.

**6. Config and secrets.** Production auth is Auth0 plus GCP-KMS-signed broker tokens.

Non-secret config (issuers, audiences, identifiers) lives in the `production` `vars` of `workers/wrangler.jsonc`: `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, `AUTH0_CLIENT_ID`, `GCP_KMS_KEY_RESOURCE` (from `terraform output kms_key_resource`), `CF_ACCOUNT_ID`, `R2_ACCOUNT_ID`. The Auth0 issuer/audience, KMS resource, and account IDs are filled in; supply `AUTH0_CLIENT_ID` (broker app) by replacing its `REPLACE_WITH_PROD_*` placeholder. The broker JWT issuer and audience default in code to `PUBLIC_ORIGIN` and `css-api`; set `BROKER_JWT_ISSUER`/`BROKER_JWT_AUDIENCE` only to match an external broker that mints the tokens.

Genuine secrets — set each with `wrangler secret put <NAME> --env production`, run from `workers/`:
- `INTERNAL_SECRET` — HMAC for broker/OAuth state and Durable-Object→API calls (generate once)
- `AUTH0_CLIENT_SECRET` — broker redirect flow
- `MAS_GCP_SERVICE_ACCOUNT_KEY` — JSON key for the `p1-backend` signer SA (see below)
- `CF_BROWSER_API_TOKEN` — screenshot rendering
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — screenshot presigning

The KMS key ring, MAC key, and IAM grant are created by Terraform (step 3). The only manual KMS step is exporting a JSON key for the `p1-backend` signer SA and storing it as `MAS_GCP_SERVICE_ACCOUNT_KEY`:

```bash
# from terraform/environments/production
gcloud iam service-accounts keys create p1-backend.json \
  --iam-account="$(terraform output -raw signer_sa_email)"
wrangler secret put MAS_GCP_SERVICE_ACCOUNT_KEY --env production < p1-backend.json
```

MCP worker (`css-mcp-server-production`) reaches the API over the `CSS_BACKEND` service binding; set its agent/server secret if one is required. The frontend has no secrets. The database password is carried by Hyperdrive, not stored as a worker secret.

**7. Migrations + deploy.** Run **Deploy Workers** → `production` with `run_migrations: true` and `dry_run: true` first to validate the build and bindings, then re-run with `dry_run: false`. Deploy the MCP worker manually.

**8. Verify.** `GET https://<api-origin>/health`; load the frontend, complete Auth0 login, open a document and confirm a live WebSocket; trigger a screenshot and confirm the object lands in `css-screenshots-production`; watch `wrangler tail --env production` for binding or secret errors.

---

## Troubleshooting

### Container services not starting

```bash
# Check your container runtime is running
docker info    # or: podman info

# View container logs
make docker-logs

# Restart services
make docker-restart
```

### Miniflare errors

```bash
# Ensure .dev.vars exists
make worker-generate-secrets

# Check Node version (20+ required)
node --version

# Reinstall dependencies
rm -rf workers/node_modules && make worker-install
```

### Database connection refused

```bash
# Check container health
make dev-status

# Wait for healthy status
./scripts/wait-for-services.sh

# Check migrations
cd workers && pnpm db:migrate:status
```

### Terraform initialization fails

```bash
# For local env, use -backend=false
cd terraform/environments/local
terraform init -backend=false

# Or use Makefile
make tf-init ENV=local
```

### Tests failing

```bash
# Ensure Docker services are running
make docker-up

# Run migrations
cd workers && pnpm db:migrate

# Run tests
pnpm test:all
```

---

## Related Documentation

- [Architecture Specification](./collaborative-state-system-architecture-v2.2.md) - Full system design
- [Implementation Progress](./PROGRESS.md) - Development status and decisions
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Yjs CRDT](https://docs.yjs.dev/)
- [Puck Editor](https://puckeditor.com) - Future frontend integration

---

## Makefile Reference

### Local Development
```bash
make dev              # Start all services (Docker + Miniflare)
make dev-docker-only  # Start Docker only
make dev-stop         # Stop all services
make dev-status       # Show service status
```

### Docker Services
```bash
make docker-up        # Start containers
make docker-down      # Stop containers
make docker-restart   # Restart containers
make docker-clean     # Remove containers AND volumes
make docker-logs      # Follow container logs
```

### Worker Development
```bash
make worker-install   # Install pnpm dependencies
make worker-dev       # Start Miniflare
make worker-generate-secrets  # Generate .dev.vars
make worker-login     # Login to Cloudflare
```

### Terraform
```bash
make tf-init ENV=local    # Initialize Terraform
make tf-plan ENV=local    # Plan changes
make tf-apply ENV=local   # Apply changes
make tf-fmt               # Format all .tf files
make tf-validate          # Validate configuration
```

### Database
```bash
make db-shell         # Open PostgreSQL shell
make db-reset         # Reset database (WARNING: destroys data)
```

### Utilities
```bash
make help             # Show all targets
make version          # Show tool versions
make clean            # Clean generated files
make clean-all        # Clean everything including Docker volumes
```

---

*Last updated: 2026-01-24*
