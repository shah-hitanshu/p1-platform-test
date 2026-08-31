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

### The registry host is hardcoded, not an env var

The base URL is committed directly in two files:

- `packages/p1-starter-components/registry.json` — the `homepage` field
- `packages/p1-starter-components/registry/p1/base/registry.json` — `config.registries`

It is currently `https://components.p1.pantheon.io`. **This URL is permanent.**
It is written into every customer's `components.json` at install time, so moving
it strands every existing install. Changing it is a migration, not an edit.

There is no `REGISTRY_HOST` environment variable. Earlier drafts of this doc
described one, along with a `patch-registry-host.mjs` script; neither was ever
implemented. To test against a local origin you do not need one — point the
namespace at localhost when you register it, and leave the built JSON alone:

```bash
pnpm dlx shadcn@latest registry add @p1=http://localhost:3005/r/{name}.json
```

### Build locally

The catalog is a Next.js app in `apps/p1-registry`. Its build runs `shadcn build`
in `packages/p1-starter-components` to flatten the `registry.json` tree into
per-item JSON under `public/r/`, then builds the app.

```bash
pnpm --filter @pantheon-systems/p1-registry build
pnpm --filter @pantheon-systems/p1-registry start   # serves on :3005
```

This is **not** a static export. Pantheon serves the app by running
`next start`, which refuses to run alongside `output: 'export'`. Pages still
prerender to static HTML, and `public/r/*.json` is served as plain static files
— so the registry URLs behave identically, without a static-only build.

`apps/p1-registry/export.test.ts` guards this: it asserts the config does not
re-enable static export and that a `start` script exists. Both are hosting
requirements, not preferences.

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

## How it is hosted

The catalog is a Pantheon Next.js site (`p1-registry`), connected to this repo's
`main` branch. Pantheon builds from source on every push — it clones the repo,
installs with pnpm, runs the root `build` script, then runs the root `start`
script to serve the app in a Node container behind Pantheon's CDN.

Three details make that work in a monorepo:

- **Scoped build.** Pantheon builds from the repo root, where `build` is
  `turbo run build` across all 18 workspace members. The root script branches on
  `PANTHEON_ENVIRONMENT` (which Pantheon sets during builds) to run
  `turbo run build --filter=@pantheon-systems/p1-registry` instead. It must be
  turbo's filter, not pnpm's — pnpm's `--filter` skips workspace dependencies, so
  `puck-css` never builds and the catalog fails with a module-not-found on
  `@pantheon-systems/puck-css/fields`.
- **Root start script.** `start` delegates to the catalog app, so `next start`
  runs with `apps/p1-registry` as its working directory.
- **pnpm stays on 10.x.** The buildpack installs pnpm by downloading a bare
  `pnpm-linux-x64` binary from the matching GitHub release. pnpm renamed that
  asset in 11.x, so any 11 pin fails the build with a 404 before install runs.
- **Static assets are copied to the repo root.** Pantheon's static-file step
  searches only `/workspace/.next/static`, `/app/.next/static` and
  `/layers/.next/static`. A monorepo app builds to
  `apps/p1-registry/.next/static`, so none match, nothing reaches the CDN, and
  every `/_next/static/*` request falls through to Node and 404s — the site
  renders with no CSS, JS or fonts. The build copies that directory to the repo
  root so the step finds it. `.next/` is gitignored, so nothing is committed.

Dev auto-deploys from every push to `main`. Live promotes when a sequential
`pantheon_live_N` git tag is pushed.

There is **no release-triggered CI for the registry.** Two workflows
(`registry-release.yml`, `deploy-registry-live.yml`) previously built the site and pushed the artifact
to an orphan `registry-deploy` branch for Pantheon to serve statically. Pantheon builds from source
instead, so that branch was never read and both fired on a release event that is no longer part of the
flow. They were removed on 2026-08-31.

One consequence worth knowing: `verify:registry` no longer runs automatically anywhere. CI runs
`registry:build`, the catalog tests and typecheck on every PR, but not the full install-37-blocks-into-a-
bare-app check. Run it by hand before promoting to Live — it is step 3 under
[Steps to ship a new block version](#steps-to-ship-a-new-block-version).

### Add or remove a block

To add one: write the block in `packages/p1-starter-components`, then add its
entry to `registry/p1/blocks/registry.json`. Add it to `@p1/base` only if its
Puck key does not collide with a p1-starter built-in — `button`, `divider`,
`heading`, `image`, `list`, `paragraph`, `quote`, `spacer` stay individually
installable so a consumer does not end up with duplicate config entries.

To remove one: delete the entry. `/r/<name>.json` starts returning 404, but
anyone who already installed it keeps a working copy — shadcn writes files into
the consumer's project, so there is no runtime dependency on this origin. A
removal is therefore silent; announce it rather than relying on a broken URL.

Either way the release path is the same as an update, below.

### Steps to ship a new block version

1. Bump `meta.version` in the block's entry in
   `packages/p1-starter-components/registry/p1/blocks/registry.json`.
2. Run `registry:build` locally and confirm the updated JSON looks right in
   `apps/p1-registry/public/r/`.
3. Run `verify:registry` — all checks must pass.
4. Merge to `main`. Pantheon builds and deploys Dev automatically.
5. Confirm the Dev origin serves the change.
6. Push the next `pantheon_live_N` tag to promote to Live.
7. Run `verify:public` against the live URL to confirm the new version is served.
