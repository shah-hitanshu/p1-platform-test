# @pantheon-systems/p1-starter-components

A library of Puck blocks — marketing, editorial, and layout — for P1 starter projects.

## Layout

```
registry/p1/blocks/          one folder per block (see below)
registry/p1/internal/        shared primitives (Btn, icons, rich-text) — not blocks
registry/p1/tokens/          design tokens (variables.css)
stories/                     Storybook stories — one file per block
scripts/generate-catalog.mjs block discovery and codegen script
```

The following files are **auto-generated** — do not edit by hand:

| File | Generated from |
|---|---|
| `registry/p1/blocks/registry.json` | `meta` in each `.block.tsx` + filesystem |
| `registry/p1/blocks/index.ts` | filesystem scan |
| `apps/p1-registry/lib/preview-map.ts` | filesystem scan |
| `apps/p1-registry/_components/PreviewRenderer.tsx` | filesystem scan |

---

## Adding a block

**1. Create the block folder with three files:**

```
registry/p1/blocks/my-block/
├── my-block.tsx        render component + prop types
├── my-block.block.tsx  Puck ComponentConfig + meta export
└── my-block.css        scoped styles (BEM: p1-my-block__*)
```

**2. Export `meta` and the block config from `my-block.block.tsx`:**

```ts
import { defineMeta } from '../define-meta';

export const meta = defineMeta({
  title: 'My Block',
  description: 'One sentence describing what it does and when to use it.',
  categories: ['content'], // attention | trust | value | showcase | convert | editorial | layout | content | global
  // registryDependencies: ['@p1/tokens', '@p1/internal-btn'], // add only if you import from a @p1/internal-* package
});

export const MyBlockBlock: ComponentConfig<MyBlockProps> = {
  fields: { ... },
  defaultProps: { ... },
  render: MyBlockRender,
};
```

**3. Run the generator:**

```bash
pnpm dev          # runs generator then starts Next dev server
# or
pnpm --filter @pantheon-systems/p1-starter-components registry:generate
```

The generator automatically:
- Adds `my-block` to `registry.json`, `index.ts`, `PreviewRenderer.tsx`, and `preview-map.ts`
- Creates `stories/my-block.stories.tsx` with a `Default` story (enhance with named variants as needed)
- Handles new categories — if `categories: ['interactive']` is new, a new drawer group appears everywhere with no extra steps

**4. Update the block count in `index.test.ts`:**

```ts
const EXPECTED_BLOCK_COUNT = 38; // bump by 1
```

---

## Deleting a block

1. Delete the block folder: `rm -rf registry/p1/blocks/my-block/`
2. Delete the story file: `rm stories/my-block.stories.tsx`
3. Run the generator: `pnpm registry:generate`
4. Decrement `EXPECTED_BLOCK_COUNT` in `index.test.ts`

The story file is **not** auto-deleted — the generator only creates stories, never removes them.

---

## Updating a block

Edit the three files in the block folder directly. No registration changes needed.

| What you change | Effect |
|---|---|
| `meta.title` / `meta.description` / `meta.categories` | Re-run generator → `registry.json` and catalog update |
| `fields` / `defaultProps` / `render` | Storybook and preview pick up changes on next run automatically |
| `meta.registryDependencies` | Re-run generator → `registry.json` updates; run `registry:build` to rebuild the shadcn output |

---

## `registryDependencies` — when to set it

Omit this field if your block only uses `@p1/tokens`. Add it when you import from an internal primitive:

| Import | Add to `registryDependencies` |
|---|---|
| `@/registry/p1/internal/btn` | `'@p1/internal-btn'` |
| `@/registry/p1/internal/icons` | `'@p1/internal-icons'` |
| `@/registry/p1/internal/rich` | `'@p1/internal-rich'` |
| `@/registry/p1/internal/form` | `'@p1/internal-form'` |

Always include `'@p1/tokens'` as the first entry when overriding the default.

---

## Storybook

```bash
pnpm --filter @pantheon-systems/p1-starter-components storybook
```

Stories live in `stories/<name>.stories.tsx`. A scaffold is created automatically when you add a block. The `Default` story uses the block's `defaultProps` — add named exports for additional variants.

- `registry/p1/blocks/` — one `ComponentConfig` per file, 37 in total.
- `registry/p1/internal/` — shared helpers (`Btn`, icons, rich-text). Not blocks, not exported.
- `registry/p1/tokens/variables.css` — design tokens. Override these in a consuming project.
- `registry/p1/blocks/index.ts` — named exports plus `marketingBlocks` and `secondaryLibraryCategories`.

## Code registry

Private and unpublished. npm publishing planned for a later phase.
## Visual regression gate

Baselines are machine-specific and gitignored. Before converting a block:

```bash
pnpm --filter @pantheon-systems/p1-starter-components build-storybook
pnpm --filter @pantheon-systems/p1-starter-components test:visual:update
```

After converting it, run `test:visual` (not `:update`). A diff means the rewrite changed rendering — open `visual/report/index.html` for the side-by-side. Do **not** re-run `test:visual:update` to make a diff go away unless the change is intentional and reviewed.

---

## Code registry

Private and unpublished. Blocks are distributed via `pnpm dlx shadcn@latest add @p1/<name>` from the hosted registry.
