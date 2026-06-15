# p1-media-r2

A monorepo providing image/media management for Puck-based P1 sites, backed by Cloudflare R2 storage. It includes a Cloudflare Worker API for storing and managing media, and a React plugin that integrates a media library UI into the Puck editor.

## Architecture

```
p1-media-r2/
  worker/           Cloudflare Worker — media write API (upload, list, delete)
  packages/
    plugin/         @pantheon-systems/p1-media-r2 — Puck editor plugin
  terraform/
    modules/
      cloudflare-media/   Terraform module for R2 bucket provisioning
    environments/
      sandbox/
      staging/
      production/
  .github/
    workflows/
      deploy-worker.yml   GHA workflow for worker deployment
```

### Delivery model

**Write path (this repo):** The Cloudflare Worker handles upload, list, and delete. Uploaded images are stored in R2 under `{siteId}/{workstreamId}/media/{timestamp}-{filename}`. The worker returns CDN delivery URLs so that stored field values point directly at the transformation layer.

**Read/delivery path (this repo):** The same Worker's `/image/*` route serves and transforms images on demand using the Cloudflare Images binding. Transformations — resize, format conversion, smart crop, face-aware crop, blur, brightness, contrast, and more — are applied at request time based on URL query params. Responses carry `Cache-Control: public, max-age=31536000, immutable` so browsers and the Cloudflare CDN cache each unique URL.

```
Editor uploads → Worker → R2 bucket
                              ↓
               media.p1.pantheon.io/image/{key}?width=1200&format=auto
                              ↓
                   Worker → Cloudflare Images binding → transformed image
```

Images are never re-uploaded or duplicated for different sizes — only the original is stored. The Images binding bills per transformation request; browser and CDN caching via the `Cache-Control` header avoids redundant calls for the same URL.

> **Production upgrade path (PCC-3277):** The Images binding is account-based and works on Workers-only accounts. When P1 zones are provisioned, this should migrate to `cf.image` (zone-level transforms) for CDN-edge execution and built-in tiered caching. Migration scope: `worker/src/handlers/image.ts` only.

### Workstream isolation

Images are namespaced by both `siteId` and `workstreamId` (branch/workstream UUID from CCR). This means:

- Images from different workstreams editing the same content slot never collide
- A new workstream's images are not referenced in live content until the workstream is published
- Discarded workstreams can have their images cleaned up by deleting the `{siteId}/{workstreamId}/media/*` prefix

### Auth

1. The plugin passes a bearer token (from `getAuthToken()`) with each API request.
2. The worker verifies the token and site access in one step by calling `GET CSS_BASE_URL/api/sites/{siteId}`. This runs through the full CSS auth pipeline — token validation, DB enrichment, and `assertPermission(canView)` — so any principal type (user, agent, service) and MAS grants are handled correctly with no extra code in this repo.
3. The CSS service binding is used when available to avoid Cloudflare error 1042 (same-account worker-to-worker requests).
4. Image delivery via `/image/*` is public — no auth required (consistent with CDN delivery).

## Worker API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/image/{key}[?params]` | No | Serve and transform an image from R2. Query params drive transformation (see below). |
| `GET` | `/media?siteId={id}&workstreamId={id}` | Yes | List media for a site + workstream (optional `search` param) |
| `POST` | `/media?siteId={id}&workstreamId={id}` | Yes | Upload media via multipart form (`file` field). Accepted: png, jpeg, gif, webp, avif. Max 10 MB. |
| `DELETE` | `/media/{key}?siteId={id}&workstreamId={id}` | Yes | Delete a media item |

All endpoints return JSON (except `/image/*`) and include CORS headers. Authenticated endpoints require `Authorization: Bearer <token>`.

### Image transformation params

| Param | Description | Example |
|-------|-------------|---------|
| `width` | Output width in pixels | `?width=400` |
| `height` | Output height in pixels | `?height=300` |
| `format` | Output format: `auto`, `webp`, `avif`, `jpeg`, `png`, `gif` | `?format=auto` |
| `quality` | Compression quality 1–100 (default 85) | `?quality=80` |
| `fit` | `contain`, `cover`, `crop`, `pad`, `scale-down` | `?fit=cover` |
| `gravity` | Crop focal point: `auto`, `face`, `left`, `right`, `top`, `bottom`, `center`, `XxY` | `?gravity=face` |
| `fit` + `gravity` | Use `fit=cover&gravity=auto` for content-aware smart crop | `?fit=cover&gravity=auto` |
| `blur` | Blur radius 0–250 | `?blur=5` |
| `brightness` | Brightness multiplier (1 = default) | `?brightness=1.2` |
| `contrast` | Contrast multiplier (1 = default) | `?contrast=0.9` |
| `saturation` | Saturation multiplier (0 = grayscale, 1 = default) | `?saturation=0` |
| `sharpen` | Sharpen amount 0–10 | `?sharpen=2` |
| `rotate` | Rotation: `90`, `180`, `270` | `?rotate=90` |
| `trim.top/left/height/width` | Manual crop region in pixels | `?trim.top=10&trim.left=20&trim.height=300&trim.width=400` |

`format=auto` negotiates the best format from the `Accept` header (avif → webp → jpeg fallback). When no transformation params are present, the raw R2 object is served directly.

### Environment variables and bindings

| Name | Type | Description |
|------|------|-------------|
| `MEDIA_BUCKET` | R2 Binding | R2 bucket for this environment |
| `IMAGES` | Images Binding | Cloudflare Images binding for on-demand transformation |
| `CSS_SERVICE` | Service Binding | CSS worker (avoids error 1042 for same-account auth calls) |
| `CSS_BASE_URL` | Var | Public base URL of the CSS auth service |
| `CDN_BASE_URL` | Var | Base URL returned in upload/list responses (e.g. `https://media.p1.pantheon.io/image`) |
| `MAX_UPLOAD_BYTES` | Var | Maximum upload size in bytes (default `10485760` = 10 MB) |

## Infrastructure

### R2 buckets

| Environment | Bucket | CDN delivery base URL |
|-------------|--------|-----------------------|
| sandbox | `p1-media-sandbox` | `https://media.sandbox.p1.pantheon.io/image` |
| staging | `p1-media-staging` | `https://media.staging.p1.pantheon.io/image` |
| production | `p1-media-prod` | `https://media.p1.pantheon.io/image` |

### Provision with Terraform

```sh
export CLOUDFLARE_API_TOKEN=<your-token>

cd terraform/environments/staging
terraform init
terraform apply -var="cloudflare_account_id=<account-id>"
```

Terraform state uses the existing GCS buckets shared with other P1 services — no new bucket required:

| Environment | State bucket | Prefix |
|-------------|-------------|--------|
| sandbox | `pantheon-css-terraform-state` | `p1-media/sandbox` |
| staging | `cpub-staging-terraform-state` | `p1-media` |
| production | `pantheon-css-terraform-state` | `p1-media/production` |

Once the custom domains are provisioned, set `custom_domain` in the relevant environment's `main.tf` and re-apply to attach it to the bucket.

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 10 (`corepack enable && corepack prepare pnpm@10`)
- Wrangler CLI (installed as a dev dependency)

### Install dependencies

```sh
pnpm install
```

### Run the worker locally

```sh
pnpm dev:worker
```

Starts a local Wrangler dev server at `http://localhost:8788` with R2 emulation. Auth falls back to `fetch` against `CSS_BASE_URL` (no service binding in local dev).

**Note:** The `wrangler.jsonc` top-level config sets `"images": { "binding": "IMAGES", "remote": true }`, which connects the Images binding to the real Cloudflare account (Pantheon P1 Sandbox) during local dev. This means all transformation params — `fit`, `gravity`, image filters, etc. — work correctly with plain `wrangler dev`. R2 stays local (miniflare), so uploaded images are accessible without touching a live bucket.

Local mode is sufficient for all features. Use `wrangler dev --env staging` (or a deployed environment) only if you need to test against live staging data.

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

Use the **Deploy Worker** workflow (`Actions → Deploy Worker → Run workflow`). Select the target environment (sandbox, staging, production) and optionally enable dry-run.

Required GitHub environment secrets per environment:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Manual

```sh
cd worker && pnpm exec wrangler deploy --env staging
```

## Plugin Usage

The plugin has two distinct audiences with different levels of involvement.

---

### For component developers

If you are building a Puck component for a P1 site, you do not need to install or configure the plugin. CCR wires it up automatically when it initialises the Puck editor — `workerUrl`, `siteId`, `workstreamId`, and `getAuthToken` all come from CCR context.

**Your only responsibility** is naming image fields using the standard patterns so the media picker activates automatically, and using `buildImageUrl` in your component's render output to apply the right dimensions and format.

#### Field naming — auto-detected patterns

Name your image fields using any of the following patterns and the media library picker will appear automatically in the Puck sidebar:

- `image`, `imageUrl`
- `logo`, `logoUrl`
- `media`, `mediaUrl`
- `icon`, `iconUrl`
- `thumbnail`, `thumbnailUrl`
- Any field ending in `ImageUrl` or `LogoUrl`

Navigation URL patterns (`buttonUrl`, `linkUrl`, `ctaUrl`) and alt text fields are excluded.

#### Applying transforms in your component

The stored field value is a clean CDN URL. Use `buildImageUrl` to add size, format, and quality at render time. It preserves any crop intent the editor may have set (e.g. `?smart=true`).

```tsx
import { buildImageUrl } from "@pantheon-systems/p1-media-r2";

// You control size and format — the editor's crop choice is preserved automatically
<img src={buildImageUrl(data.heroImage, { width: 1200, height: 630, format: "webp" })} />
<img src={buildImageUrl(data.thumbnail, { width: 150, height: 150, format: "webp", quality: 80 })} />
```

#### Stored field value format

For reference, the value stored in Puck data looks like:

```
https://media.p1.pantheon.io/image/{siteId}/{workstreamId}/media/{timestamp}-{filename}
```

With fit-in (scale to fit, no cropping or padding):

```
https://media.p1.pantheon.io/image/{siteId}/{workstreamId}/media/{timestamp}-{filename}?fit=scale-down
```

With smart crop (content-aware crop to fill):

```
https://media.p1.pantheon.io/image/{siteId}/{workstreamId}/media/{timestamp}-{filename}?fit=cover&gravity=auto
```

`buildImageUrl` merges transform params onto the stored URL at render time, so component developers only need to specify `width`, `height`, `format`, and `quality`. The editor-set crop intent is preserved automatically.

---

### For site developers enabling the media library

If you are building a P1-powered site and want editors to have a media library in the Puck sidebar, install this package and add the media plugin alongside the standard CCR editor setup. The values required by `createMediaPlugin` — site ID, workstream ID, and auth token — are all available from CCR context, so no additional configuration is needed beyond wiring them through.

#### Install

```sh
pnpm add @pantheon-systems/p1-media-r2
```

#### Integration with puck-css

Pass the media plugin via `additionalPlugins` in `useP1Editor`. The hook handles stable plugin merging internally — no manual override wiring needed.

```tsx
import { useMemo } from "react";
import { Puck } from "@puckeditor/core";
import { createMediaPlugin } from "@pantheon-systems/p1-media-r2";
import { useP1Editor, useP1Auth } from "@pantheon-systems/puck-css";

function Editor({ siteId, workstreamId, documentPath, config }) {
  const { getToken } = useP1Auth();

  const mediaPlugin = useMemo(
    () =>
      createMediaPlugin({
        workerUrl: "https://media.staging.p1.pantheon.io",
        siteId,       // from CCR context
        workstreamId, // from CCR context
        getAuthToken: getToken, // from useP1Auth — always returns the current token
      }),
    [siteId, workstreamId, getToken],
  );

  const { loading, error, puckKey, puckProps } = useP1Editor({
    documentPath,
    puckConfig: config,
    additionalPlugins: [mediaPlugin],
  });

  if (loading) return null;
  if (error) return <div>Error: {error.message}</div>;
  return <Puck key={puckKey} {...puckProps} />;
}
```

#### `createMediaPlugin` options

| Option | Type | Description |
|--------|------|-------------|
| `workerUrl` | `string` | Base URL of the deployed p1-media Worker |
| `siteId` | `string` | Site UUID — from CCR context |
| `workstreamId` | `string` | Workstream UUID — from CCR context |
| `getAuthToken` | `() => Promise<string \| null> \| string \| null` | Returns the CCR auth bearer token — pass `useP1Auth().getToken` directly |
| `fieldNamePatterns` | `RegExp[]` | Override the default field name patterns |

---

### Exports

```ts
import {
  createMediaPlugin,           // Plugin factory (for CCR integration)
  buildImageUrl,               // Apply transform params to a CDN URL (for components)
} from "@pantheon-systems/p1-media-r2";

import type {
  MediaPluginOptions,          // createMediaPlugin config shape
  ImageTransformParams,        // { width?, height?, format?, quality? }
} from "@pantheon-systems/p1-media-r2";

import { DEFAULT_MEDIA_PATTERNS } from "@pantheon-systems/p1-media-r2";
```
