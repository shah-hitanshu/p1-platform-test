# p1-media-r2

A monorepo providing image/media management for Puck-based P1 sites, backed by Cloudflare R2 (bytes) and D1 (metadata). It includes a Cloudflare Worker API for uploading, versioning, and serving media with editable metadata (alt text, caption, …), and a React plugin that integrates a media library UI and a rich `p1-media` field type into the Puck editor.

This document covers working **on** this repo — architecture, infrastructure, local development, and deployment. If you're looking for how to **use** what it produces:

- **Integrating the Puck plugin** (component and site developers) → [`docs/plugin-usage.md`](docs/plugin-usage.md)
- **Calling the Worker API directly** (e.g. an MCP tool or other service) → [`docs/openapi.yaml`](docs/openapi.yaml), served with an interactive Swagger UI at `/docs` on the deployed worker

## Architecture

```
p1-media-r2/
  worker/           Cloudflare Worker — media API (upload, version, list, get,
                    metadata PATCH, soft-delete) + on-demand image transforms
    migrations/     D1 schema migrations (assets + asset_versions)
  packages/
    plugin/         @pantheon-systems/p1-media — Puck editor plugin + render helpers
  terraform/
    modules/
      cloudflare-media/   Terraform module — R2 bucket + D1 database
    environments/
      sandbox/
      staging/
      production/
  .github/
    workflows/
      deploy-worker.yml   GHA workflow — D1 migrations + worker deploy
      publish.yml         GHA workflow — plugin npm publish (OIDC)
```

### Delivery model

**Write path (this repo):** The Worker stores an uploaded image as an **asset** with an
**immutable version**. Bytes go to R2 under `{siteId}/assets/{assetId}/{versionId}-{filename}`;
metadata (filename, dimensions, alt, caption, …) goes to D1. Replacing an image adds a new
immutable version and repoints the asset's `current_version` — old versions are never
overwritten. The Worker returns an asset record (`MediaAsset`) whose `url` is a CDN
delivery URL for the current version.

**Read/delivery path (this repo):** The same Worker's `/image/*` route serves and transforms images on demand using the Cloudflare Images binding. Transformations — resize, format conversion, smart crop, face-aware crop, blur, brightness, contrast, and more — are applied at request time based on URL query params. Responses carry `Cache-Control: public, max-age=31536000, immutable` so browsers and the Cloudflare CDN cache each unique URL.

```
                          ┌── R2 bucket        (immutable version bytes)
Editor uploads → Worker ──┤
                          └── D1: assets +      (metadata defaults; alt, caption, …)
                              asset_versions
        │
        │  On select, the editor copies the chosen version's URL + metadata
        │  into the Puck document (edit-time join). Published pages render from
        │  the document alone — <Render> never calls this API.
        ▼
   media.p1.pantheon.io/image/{key}?width=1200&format=auto
        │
        ▼
   Worker → Cloudflare Images binding → transformed image
```

Images are never re-uploaded or duplicated for different sizes — only the original bytes are stored per version. The Images binding bills per transformation request; browser and CDN caching via the `Cache-Control` header avoids redundant calls for the same URL.

> **Production upgrade path (PCC-3277):** The Images binding is account-based and works on Workers-only accounts. When P1 zones are provisioned, this should migrate to `cf.image` (zone-level transforms) for CDN-edge execution and built-in tiered caching. Migration scope: `worker/src/handlers/image.ts` only.

### Asset model & workstream semantics

The media library is **site-scoped and workstream-agnostic**. An asset is a logical
identity (`assetId`); each upload or replacement creates an immutable `versionId`.

- **CCR owns workstream state, not the media store.** Which version a page shows is
  decided by the version pinned in the CCR-managed Puck document, which already has
  draft / preview / merge / rollback. The Worker knows nothing about workstreams
  (the `workstreamId` query param is accepted for backward compatibility and ignored).
- **Immutable version URLs** cache indefinitely and never need invalidation.
- **`DELETE` is a soft delete** — the asset is hidden from the library but its bytes keep
  serving, so already-published pages don't break. A hard-purge path for legal takedown
  is tracked separately (**PCC-3386**); it is required because the `immutable` cache
  headers mean a deleted object otherwise keeps serving for up to a year.

### Auth

1. The plugin passes a bearer token (from `getAuthToken()`) with each API request.
2. The worker verifies the token and site access in one step by calling `GET CCR_BASE_URL/api/sites/{siteId}`. This runs through the full CCR auth pipeline — token validation, DB enrichment, and `assertPermission(canView)` — so any principal type (user, agent, service) and MAS grants are handled correctly with no extra code in this repo.
3. The CCR service binding is used when available to avoid Cloudflare error 1042 (same-account worker-to-worker requests).
4. Image delivery via `/image/*` is public — no auth required (consistent with CDN delivery).

> **Write-role gate (PCC-3278):** today all authenticated endpoints assert only
> `canView`. Uploading, versioning, patching metadata, and deleting should require an
> editor role (`canEditDocuments`), but CCR does not yet expose the caller's effective
> role to the worker. Marked `TODO(PCC-3278)` in `worker/src/index.ts`. The write
> endpoints must **not** be exposed on a live worker until that check lands — the primary
> path (Puck editor with a user JWT → EDITOR/ADMIN) is unaffected, but a viewer-role
> agent or service token could otherwise write.

## Worker API

The full request/response contract — all endpoints, auth, the `MediaAsset` shape, and
every image transformation param — is the OpenAPI spec at
[`docs/openapi.yaml`](docs/openapi.yaml). The deployed worker serves it with an
interactive Swagger UI at `/docs` (and the raw spec at `/docs/openapi.yaml`); both are
unauthenticated so the API surface is publicly browsable. This section previously
duplicated that table — kept in one place now to avoid drift.

### Environment variables and bindings

| Name | Type | Description |
|------|------|-------------|
| `MEDIA_BUCKET` | R2 Binding | R2 bucket for this environment (immutable version bytes) |
| `MEDIA_DB` | D1 Binding | D1 database holding asset + version metadata (`database_id` from the Terraform `d1_database_id` output) |
| `IMAGES` | Images Binding | Cloudflare Images binding for on-demand transformation |
| `CCR_SERVICE` | Service Binding | CCR worker (avoids error 1042 for same-account auth calls) |
| `CCR_BASE_URL` | Var | Public base URL of the CCR auth service |
| `CDN_BASE_URL` | Var | Base URL returned in upload/list responses (e.g. `https://media.p1.pantheon.io/image`) |
| `MAX_UPLOAD_BYTES` | Var | Maximum upload size in bytes (default `10485760` = 10 MB) |
| `RECONCILE_DRY_RUN` | Var | Orphan-reconcile Cron Trigger safety switch — see below. Defaults to dry-run unless literally `"false"` |

### Orphan-reconcile Cron Trigger

A scheduled job (hourly in staging/production; `worker/src/handlers/reconcile.ts`) deletes
R2 objects from abandoned presigned uploads — a client PUTs bytes but never calls
`/finalize` (tab closed, network blip). It only ever considers objects with no
`asset_versions` row referencing them AND older than 24h, re-checking each candidate
against D1 immediately before deleting (not just an upfront snapshot) so a legitimately
slow finalize can't lose the race. Ships with `RECONCILE_DRY_RUN: "true"` in every
environment — it logs candidates but deletes nothing until an operator reviews those
logs (`wrangler tail` or the dashboard) and manually flips the var to `"false"` for that
environment.

## Infrastructure

### R2 buckets and D1 databases

Each environment lives in its own Cloudflare account and gets a same-named R2 bucket and D1 database.

| Environment | Bucket / D1 name | CDN delivery base URL |
|-------------|------------------|-----------------------|
| sandbox | `p1-media-sandbox` | `https://media.sandbox.p1.pantheon.io/image` |
| staging | `p1-media-staging` | `https://staging.media.p1.pantheon.io/image` |
| production | `p1-media-prod` | `https://media.p1.pantheon.io/image` |

### Provision with Terraform

The module creates both the R2 bucket and the D1 database. The Cloudflare API token must carry **D1 edit scope** in addition to R2/Workers.

```sh
export CLOUDFLARE_API_TOKEN=<your-token>   # needs R2 + D1 edit scope

cd terraform/environments/staging
terraform init
terraform apply -var="cloudflare_account_id=<account-id>"

# Copy the D1 id into wrangler.jsonc for this env (database_id, like bucket_name):
terraform output d1_database_id
```

After provisioning, paste the `d1_database_id` value into the matching env block's
`d1_databases` binding in `worker/wrangler.jsonc` (it ships with a `REPLACE_WITH_TF_d1_database_id`
placeholder), then apply schema migrations (see Deployment).

Terraform state uses the existing GCS buckets shared with other P1 services — no new bucket required:

| Environment | State bucket | Prefix |
|-------------|-------------|--------|
| sandbox | `pantheon-css-terraform-state` | `p1-media/sandbox` |
| staging | `cpub-staging-terraform-state` | `p1-media` |
| production | `pantheon-css-terraform-state` | `p1-media/production` |

Once the custom domains are provisioned, set `custom_domain` in the relevant environment's `main.tf` and re-apply to attach it to the bucket.

## Development

### Prerequisites

- Node.js >= 22.5 (the worker test suite uses the built-in `node:sqlite` for its real-D1 harness)
- pnpm >= 10 (`corepack enable && corepack prepare pnpm@10`)
- Wrangler CLI (installed as a dev dependency)

### Install dependencies

```sh
pnpm install
```

### Run the worker locally

First apply the D1 schema to the local database (once, and after any new migration):

```sh
cd worker
pnpm exec wrangler d1 migrations apply p1-media-local --local
```

Then start the dev server:

```sh
pnpm dev:worker
```

Starts a local Wrangler dev server at `http://localhost:8788` with local R2 and D1 (miniflare). 

**Images binding:** the top-level `wrangler.jsonc` sets `"images": { "binding": "IMAGES", "remote": true }`, connecting to the real Cloudflare account (Pantheon P1 Sandbox) during local dev, so all transformation params — `fit`, `gravity`, filters, etc. — work with plain `wrangler dev`. Upload, list, metadata, and *raw* image serving work without it (dimension capture via `IMAGES.info()` is best-effort and degrades to no dimensions if unavailable).

**Auth in local dev:** `validateAuth` calls `CCR_BASE_URL`, which by default points at `localhost` and has no CCR running. For an end-to-end local run, point `CCR_BASE_URL` at a reachable CCR (e.g. staging) and use a real bearer token — this exercises the real auth path. `wrangler dev --env staging` runs against live staging data. Nothing in local testing depends on PCC-3278: for a normal editor token the `canView` check behaves identically before and after that work.

To drive the plugin against your local worker, set the plugin's `workerUrl` to `http://localhost:8788`.

### Run tests

```sh
# Worker
cd worker && pnpm test

# Plugin
cd packages/plugin && pnpm test
```

### Build

```sh
pnpm build
```

## Deployment

### Via GitHub Actions (recommended)

Use the **Deploy Worker** workflow (`Actions → Deploy Worker → Run workflow`). Select the target environment (sandbox, staging, production) and optionally enable dry-run. The workflow applies D1 migrations (`--remote`, skipped on dry-run) before deploying the worker.

Required GitHub environment config per environment:
- `CLOUDFLARE_API_TOKEN` (via Secret Manager) — must carry **D1 edit scope** as well as Workers/R2
- `CLOUDFLARE_ACCOUNT_ID`

### Manual

Apply migrations before deploying (additive-only, so migrating ahead of the code is safe):

```sh
cd worker
pnpm exec wrangler d1 migrations apply p1-media-staging --env staging --remote
pnpm exec wrangler deploy --env staging
```

> **Prerequisite:** the env's `d1_databases.database_id` in `wrangler.jsonc` must be set to the real D1 id from Terraform (`terraform output d1_database_id`) — it ships as a placeholder.
