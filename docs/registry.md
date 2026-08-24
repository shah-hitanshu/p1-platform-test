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

Then add the registry to `components.json`:

```json
{
  "registries": {
    "@p1": "https://P1_REGISTRY_HOST_TBD/r/{name}.json"
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

### Build the static output

The registry is a static Next.js app in `apps/p1-registry`. Its build step
runs `shadcn build` in `packages/p1-starter-components` to flatten the
`registry.json` tree into per-item JSON files under `public/r/`, then exports
the catalog app to `out/`.

```bash
pnpm --filter @pantheon-systems/p1-registry build
```

The output in `out/` is a self-contained static site that can be hosted on any
CDN. Deploying it is the human-gated step (Tasks 5 & 6 in PCC-3580 phase 3)
because the hostname and Pantheon site are decided outside this repo.

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
pnpm --filter @pantheon-systems/p1-starter-components verify:public https://P1_REGISTRY_HOST_TBD
```

`verify/public-install.sh` checks that every item returns `200` with correct
cache headers, installs `@p1/base` into a clean project using the public URL,
and confirms `--diff` works on an edited block.

## Releasing a new block version

The registry is not an npm package — there is no `changeset` flow. A release
is a deploy:

1. Bump `meta.version` in the block's entry in
   `registry/p1/blocks/registry.json` (currently `"0.1.0"`).
2. Run `pnpm --filter @pantheon-systems/p1-starter-components registry:build`
   locally and verify the updated JSON looks right in `apps/p1-registry/public/r/`.
3. Run `verify:registry` and confirm all checks pass.
4. Merge to `main`.
5. The GitHub Actions deploy workflow (human-gated) rebuilds and publishes the
   static site.
6. Run `verify:public` against the live URL to confirm the new version is
   served correctly.

There is no rollback mechanism beyond re-deploying the previous commit. Keep
the deploys small.
