# P1 block registry

The P1 block registry distributes the 37 Puck blocks from
`packages/p1-starter-components` as a shadcn code registry. Consumers install
blocks directly into their project with the shadcn CLI; there is no npm package
to version or peer-depend on.

## Consuming the registry

### Prerequisites

A Next.js project with a `components.json` that declares the `@p1` registry
endpoint. Run once per project:

```bash
pnpm dlx shadcn@latest init
```

Then add the registry to `components.json`, replacing `<host>` with the
registry URL (e.g. `https://p1-registry.yourdomain.io`):

```json
{
  "registries": {
    "@p1": "https://<host>/r/{name}.json"
  }
}
```

### Install a single block

```bash
pnpm dlx shadcn@latest add @p1/hero
```

The CLI writes the block's three files (`.tsx`, `.block.tsx`, `.css`) into
`components/puck/blocks/<name>/`, ready to import and register in your Puck
config. The CSS file is yours — override any class.

### Install the non-collider set (29 blocks + tokens)

```bash
pnpm dlx shadcn@latest add @p1/base
```

`@p1/base` installs `@p1/tokens` plus the 29 blocks whose Puck keys don't
collide with the p1-starter built-ins. The eight colliders — `button`,
`divider`, `heading`, `image`, `list`, `paragraph`, `quote`, `spacer` — are
installed individually when you need them. They are excluded from `@p1/base`
because p1-starter already ships blocks under those keys; installing both would
create duplicate config entries.

### Install tokens only

```bash
pnpm dlx shadcn@latest add @p1/tokens
```

Writes `app/p1-tokens.css` and `app/p1-base.css`. Override any `--p1-*`
variable to retheme every block at once. The catalog's `/theme` route shows the
full token set.

### Update a block after customising it

```bash
pnpm dlx shadcn@latest add @p1/hero --diff
```

Shows a diff of the upstream block against your local copy. Useful for
reviewing upstream changes before deciding to apply them.

```bash
pnpm dlx shadcn@latest add @p1/hero --overwrite
```

Replaces the local copy with the upstream version, discarding local changes.

## Building and deploying the registry

### The `REGISTRY_HOST` env var

`REGISTRY_HOST` controls the base URL baked into every registry item's `files`
and `registryDependencies` URLs. Set it before building:

- **Local dev:** defaults to `http://localhost:3005` (no var needed)
- **Production:** set `REGISTRY_HOST` in GitHub repo Settings → Variables to
  the hosting URL (e.g. `https://p1-registry.yourdomain.io`) before cutting
  the first release.

The patch script (`packages/p1-starter-components/scripts/patch-registry-host.mjs`)
rewrites the placeholder in `public/r/*.json` immediately after `shadcn build`.

### Build the static output locally

The registry is a static Next.js app in `apps/p1-registry`. Its build step
runs `shadcn build` in `packages/p1-starter-components` to flatten the
`registry.json` tree into per-item JSON files under `public/r/`, then exports
the catalog app to `out/`.

```bash
# Default host (localhost:3005)
pnpm --filter @pantheon-systems/p1-registry build

# Custom host
REGISTRY_HOST=https://p1-registry.yourdomain.io pnpm --filter @pantheon-systems/p1-registry build
```

The output in `out/` is a self-contained static site that can be served by any
CDN or static host. Serve it locally to test:

```bash
npx serve apps/p1-registry/out -l 3005
```

### Pre-deploy verification

After the build, run the local verification suite to confirm the registry is
internally consistent and all blocks install cleanly into a bare project:

```bash
pnpm --filter @pantheon-systems/p1-starter-components verify:registry
```

This runs two scripts from `packages/p1-starter-components/verify/`:

- `install-all.sh` — builds the registry, creates a bare Next.js project,
  installs `@p1/base` (expects 29 blocks), then installs the 8 colliders
  individually (expects 37 total), confirms imports resolve, and runs `tsc` and
  `next build`.
- `update-semantics.sh` — installs a single block, simulates a customer edit,
  confirms `--diff` detects the change, confirms plain re-add preserves it, and
  confirms `--overwrite` replaces it.

### Post-deploy validation

Once the registry is live, validate it from a clean machine (no registry build
artifacts, no workspace deps):

```bash
pnpm --filter @pantheon-systems/p1-starter-components verify:public https://<host>
```

`verify/public-install.sh` checks that every item returns `200` with correct
cache headers, installs `@p1/base` into a clean project using the public URL,
and confirms `--diff` works on an edited block.

## Release flow (automated via GitHub Actions)

Publishing a GitHub Release triggers `.github/workflows/registry-release.yml`:

1. Checks out the release tag
2. Runs `verify:registry` — build fails if any block fails to install cleanly
3. Builds the static catalog with `REGISTRY_HOST` from repo variables
4. Opens a PR from `deploy/registry-<tag>` into `registry-deploy` for review

Merging that PR triggers `.github/workflows/deploy-registry-live.yml`, which
pushes the next sequential `pantheon_live_N` tag so Pantheon promotes the build
to live.

The `registry-deploy` orphan branch is created automatically on the first
release if it doesn't exist — no manual setup required.

### Steps to ship a new block version

1. Bump `meta.version` in the block's entry in
   `packages/p1-starter-components/registry/p1/blocks/registry.json`.
2. Run `registry:build` locally and confirm the updated JSON looks right in
   `apps/p1-registry/public/r/`.
3. Run `verify:registry` — all checks must pass.
4. Merge to `main`.
5. Publish a GitHub Release (any semver tag, e.g. `v0.2.0`).
6. Review and merge the deploy PR the workflow opens into `registry-deploy`.
7. Run `verify:public` against the live URL to confirm the new version is
   served correctly.

There is no automated rollback — re-deploy the previous tag if needed.

## Catalog app

`apps/p1-registry` is the catalog. It serves:

- `/` — block grid with live iframe previews, category filter, and install commands
- `/preview/<name>` — bare block render at 1280 px (loaded in the catalog's iframes)
- `/theme` — full token listing with a one-click copy

The catalog is a static Next.js export (`output: 'export'`). It is rebuilt and
deployed as part of the same release flow as the registry JSON.
