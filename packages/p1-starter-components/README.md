# @pantheon-systems/p1-starter-components

A library of 37 Puck blocks — marketing, editorial, and layout — for P1 starter
projects. Migrated from `pantheon-systems/p1-starter-components`.

## Storybook

```bash
pnpm --filter @pantheon-systems/p1-starter-components storybook
```

## Layout

- `registry/p1/blocks/` — one `ComponentConfig` per file, 37 in total.
- `registry/p1/internal/` — shared helpers (`Btn`, icons, rich-text). Not blocks, not exported.
- `registry/p1/tokens/variables.css` — design tokens. Override these in a consuming project.
- `registry/p1/blocks/index.ts` — named exports plus `marketingBlocks` and `secondaryLibraryCategories`.

## Code registry

The 37 blocks are distributed as a shadcn code registry. Consumers install directly
into their projects — no npm package required:

```bash
# All 29 non-collider blocks + tokens in one command
pnpm dlx shadcn@latest add @p1/base

# Or a single block
pnpm dlx shadcn@latest add @p1/hero
```

**Live catalog:** `https://P1_REGISTRY_HOST_TBD` (placeholder — updated when the site is deployed)

See [docs/registry.md](../../docs/registry.md) for the full consuming and releasing workflow.

### Build the registry locally

```bash
pnpm --filter @pantheon-systems/p1-starter-components registry:build
```

This runs `shadcn build` and writes per-item JSON to `apps/p1-registry/public/r/`.

### Verify before deploy

```bash
pnpm --filter @pantheon-systems/p1-starter-components verify:registry
```

## Visual regression gate

Baselines are machine-specific and gitignored. Before converting a block:

```bash
pnpm --filter @pantheon-systems/p1-starter-components build-storybook
pnpm --filter @pantheon-systems/p1-starter-components test:visual:update
```

After converting it, the same two commands with `test:visual`. A diff means the rewrite changed
rendering — open `visual/report/index.html` for the side-by-side. Do **not** re-run
`test:visual:update` to make a diff go away unless the change is intended and reviewed.
