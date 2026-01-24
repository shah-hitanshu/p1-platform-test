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
│   ├── wrangler.jsonc                # Cloudflare Worker config
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── vitest.config.ts              # Unit test configuration
│   ├── vitest.integration.config.ts  # Integration test configuration
│   ├── eslint.config.js              # ESLint configuration
│   ├── .dev.vars                     # Local secrets (gitignored)
│   ├── mock-identity.config.json     # Test users/agents config
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
│       └── workers/                  # Worker configuration module
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
| Docker | Latest | [docker.com](https://www.docker.com/) |
| Terraform | 1.6+ | [terraform.io](https://www.terraform.io/) |

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

Local development uses Docker Compose for PostgreSQL and Firestore emulator.

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
- **Environment overrides**: `sbx1`, `production`

### Mock Identity Configuration

`workers/mock-identity.config.json` defines test users and agents for local development:

```json
{
  "users": [
    {
      "id": "user-alice",
      "email": "alice@example.com",
      "name": "Alice Developer",
      "siteRoles": { "site-123": "admin" }
    }
  ],
  "agents": [
    {
      "id": "agent-zappy",
      "name": "Zappy AI Assistant",
      "apiKey": "test-agent-key-zappy",
      "siteRoles": { "site-123": "editor" }
    }
  ]
}
```

---

## Deployment

### Cloudflare Workers

```bash
cd workers

# Deploy to sandbox
pnpm deploy:sbx1

# Deploy to production
pnpm deploy:production
```

### Required Secrets (Production)

Set via Cloudflare dashboard or CLI:
- `POSTGRES_CONNECTION_STRING` - CloudSQL connection string
- `JWT_SECRET` - Production JWT signing key

---

## Troubleshooting

### Docker services not starting

```bash
# Check Docker is running
docker info

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
docker-compose -f docker/docker-compose.local.yaml ps

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
