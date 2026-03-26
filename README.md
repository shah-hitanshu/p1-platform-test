# p1-media-r2

A monorepo providing image/media management for Puck-based sites, backed by Cloudflare R2 storage. It includes a Cloudflare Worker API for storing and serving media, and a React plugin that integrates a media library UI into the Puck editor.

## Architecture

```
p1-media-r2/
  worker/           Cloudflare Worker media API (R2 storage)
  packages/
    plugin/         @pantheon/p1-media-r2 - Puck plugin package
```

**Worker (`p1-media`)** -- A Cloudflare Worker that manages media files in an R2 bucket (`p1-media`). It provides endpoints for uploading, listing, serving, and deleting images. Authenticated endpoints validate bearer tokens against the Collaborative State Service (CSS) at `CSS_BASE_URL/api/auth/me`. Images are stored under `{siteId}/{filename}` keys and served publicly without authentication.

**Plugin (`@pantheon/p1-media-r2`)** -- A React/Puck plugin that overrides Puck text fields matching image-related name patterns (e.g., `image`, `logo`, `mediaUrl`, `icon`, `thumbnail`) and replaces them with a media library picker. The picker lets editors browse, upload, search, and select images from the R2-backed media library.

**Auth flow:**
1. The plugin passes a bearer token (obtained via `getAuthToken()`) with each API request.
2. The worker validates the token by calling `CSS_BASE_URL/api/auth/me`.
3. Public image serving (`GET /image/*`) requires no authentication.

## Worker API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/image/{siteId}/{filename}` | No | Serve an image publicly |
| `GET` | `/media?siteId={id}&search={term}` | Yes | List media for a site (optional search filter) |
| `POST` | `/media?siteId={id}` | Yes | Upload media via multipart form data |
| `DELETE` | `/media/{key}?siteId={id}` | Yes | Delete a media item |

All endpoints return JSON (except image serving) and include CORS headers. Authenticated endpoints expect an `Authorization: Bearer <token>` header.

### Environment Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `MEDIA_BUCKET` | R2 Bucket | The `p1-media` R2 bucket |
| `CSS_BASE_URL` | Variable | Base URL for the CSS auth service |

## Setup

### Prerequisites

- Node.js >= 18
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9.15.0`)
- A Cloudflare account with R2 enabled
- Wrangler CLI (installed as a dev dependency)

### Install Dependencies

```sh
pnpm install
```

### Configure Wrangler

The worker configuration is in `worker/wrangler.toml`. The default settings point to the `p1-media` R2 bucket and the production CSS endpoint. Adjust `CSS_BASE_URL` if you need to target a different environment.

## Development

### Run the Worker Locally

```sh
pnpm dev:worker
```

This starts a local Wrangler dev server with R2 emulation. The worker will be available at `http://localhost:8787`.

### Build All Packages

```sh
pnpm build
```

### Run Tests

```sh
# Worker tests
cd worker && pnpm test

# Plugin tests
cd packages/plugin && pnpm test
```

### Lint

```sh
pnpm lint
```

## Deployment

### Deploy the Worker

```sh
cd worker && pnpm deploy
```

This deploys the worker using Wrangler. The current deployment is at:

```
https://p1-media.chris-801.workers.dev
```

Ensure the `p1-media` R2 bucket exists in your Cloudflare account before deploying.

### Publish the Plugin

The plugin package (`@pantheon/p1-media-r2`) is built with `tsup` and outputs CJS, ESM, and TypeScript declarations to `dist/`. Publish with:

```sh
cd packages/plugin && pnpm build && npm publish
```

## Plugin Usage

### Install

```sh
npm install @pantheon/p1-media-r2
# or
pnpm add @pantheon/p1-media-r2
```

### Configure

```tsx
import { createMediaPlugin } from "@pantheon/p1-media-r2";
import { Puck } from "@puckeditor/core";

const mediaPlugin = createMediaPlugin({
  workerUrl: "https://p1-media.chris-801.workers.dev",
  siteId: "my-site-id",
  getAuthToken: () => localStorage.getItem("auth_token"),
});

function Editor() {
  return <Puck plugins={[mediaPlugin]} config={config} data={data} />;
}
```

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `workerUrl` | `string` | Yes | Base URL of the deployed Cloudflare Worker |
| `siteId` | `string` | Yes | Site identifier used to scope media storage |
| `getAuthToken` | `() => string \| null` | Yes | Function returning the current auth token |
| `fieldNamePatterns` | `RegExp[]` | No | Custom patterns for field names that trigger the media picker |

### Default Field Name Patterns

The plugin auto-detects image URL fields by matching field names against these patterns:

- `image`, `imageUrl`
- `logo`, `logoUrl`
- `media`, `mediaUrl`
- `icon`, `iconUrl`
- `thumbnail`, `thumbnailUrl`
- Fields ending in `ImageUrl` or `LogoUrl`

Fields matching navigation URL patterns (e.g., `buttonUrl`, `linkUrl`, `ctaUrl`) and alt text fields are intentionally excluded.

### Exports

```ts
// Main factory function
export { createMediaPlugin } from "@pantheon/p1-media-r2";

// Types
export type { MediaPluginOptions } from "@pantheon/p1-media-r2";
export type { MediaConfig } from "@pantheon/p1-media-r2";

// Default patterns (for customization)
export { DEFAULT_MEDIA_PATTERNS } from "@pantheon/p1-media-r2";
```
