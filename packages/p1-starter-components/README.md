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
| `apps/p1-registry/lib/catalog.generated.tsx` | filesystem scan — preview names, category order, dynamic imports |

---

## Getting the blocks

Browse everything available, with the exact command for each, in the
**[P1 component catalog](https://components.p1.pantheon.io/)**.

A project scaffolded by
[create-p1-starter-kit](https://www.npmjs.com/package/@pantheon-systems/create-p1-starter-kit) is
already configured for the `@p1` registry, whichever way it answered the component-library prompt:

```bash
pnpm dlx shadcn@latest add @p1/pricing
```

The install prints the three lines to paste into `components/puck/blocks/index.ts`:

```ts
import { PricingBlock } from "./pricing/pricing.block";
P1Pricing: PricingBlock,                                        // in p1Blocks
p1Convert: { title: "P1 Convert", components: ["P1Pricing"] },  // in p1Categories
```

The category line is what puts the block in the editor drawer. A block registered in `p1Blocks`
alone still works, but stays out of the drawer with no error. Repeat for each block you want — a
block's export name is at the top of `components/puck/blocks/<name>/<name>.block.tsx` and does not
always match the directory: `@p1/logos` exports `LogoCloudBlock`.

### Projects scaffolded before the component-library release

They have no `components.json`, no `@/*` path alias and no blocks barrel, and nothing back-fills
them. `shadcn add @p1/…` fails with `Unknown registry "@p1"` until all three exist. One command
writes all three:

```bash
npx @pantheon-systems/p1-next-sdk enable-registry
```

It ships with `@pantheon-systems/p1-next-sdk`, skips anything already in place, and edits
`tsconfig.json` as text so comments survive. If you need to do it by hand instead:

**1. Create `components.json`** at the project root:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "p1",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/styles.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks", "utils": "@/lib/utils" },
  "registries": { "@p1": "https://components.p1.pantheon.io/r/{name}.json" }
}
```

Write the file rather than running `shadcn init`, which rewrites `app/styles.css` and drops the
`@plugin` and `@source` lines the starter kit ships. Omitting `style`, `rsc` or `tailwind` fails with
`Invalid configuration found`.

**2. Add the path alias** to `tsconfig.json`, alongside the React mappings already there:

```json
"paths": {
  "@/*": ["./*"],
  "react": ["./node_modules/@types/react"],
  "react-dom": ["./node_modules/@types/react-dom"],
  "react/jsx-runtime": ["./node_modules/@types/react/jsx-runtime"]
}
```

**3. Create the barrel** at `components/puck/blocks/index.ts` and spread it from `puck.config.tsx`:

```ts
import type { Config } from "@puckeditor/core";

export const p1Blocks = {} satisfies Config["components"];

export const p1Categories = {} satisfies NonNullable<Config["categories"]>;
```

```tsx
import { p1Blocks, p1Categories } from "./components/puck/blocks";

export const config = {
  categories: {
    ...p1Categories,   // first, so your own categories are declared after
    typography: { … },
  },
  components: {
    ...p1Blocks,       // first, for the same reason
    HeadingBlock: headingBlock,
  },
} as Config;
```

Both spreads must come first. Later keys win in an object literal, so a spread placed last lets a
registry category overwrite one of yours — the blocks stay registered and disappear from the drawer,
which looks like a broken install rather than a merge.

Scaffolding a new project and moving your work across is often less effort than step 3.

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
import { defineMeta } from '@/registry/p1/internal/define-meta';

export const meta = defineMeta({
  title: 'My Block',
  description: 'One sentence describing what it does and when to use it.',
  categories: ['content'], // attention | trust | value | showcase | convert | editorial | layout | content | global
  published: true,      // false = Storybook only, not visible in catalog or registry
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
- Adds `my-block` to `registry.json` and `catalog.generated.tsx`
- Creates `stories/my-block.stories.tsx` with a `Default` story (enhance with named variants as needed)
- Handles new categories — if `categories: ['interactive']` is new, a new drawer group appears everywhere with no extra steps

No registration step needed — tests discover blocks from the filesystem directly.

---

## Deleting a block

1. Delete the block folder: `rm -rf registry/p1/blocks/my-block/`
2. Delete the story file: `rm stories/my-block.stories.tsx`
3. Run the generator: `pnpm registry:generate`

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

---

## Visual regression gate

Baselines are machine-specific and gitignored. Before converting a block:

```bash
pnpm --filter @pantheon-systems/p1-starter-components build-storybook
pnpm --filter @pantheon-systems/p1-starter-components test:visual:update
```

After converting it, run `test:visual` (not `:update`). A diff means the rewrite changed rendering — open `visual/report/index.html` for the side-by-side. Do **not** re-run `test:visual:update` to make a diff go away unless the change is intentional and reviewed.

---

## Code registry

Private and unpublished. Blocks are distributed via `pnpm dlx shadcn@latest add @p1/<name>` from the
hosted registry, and browsable in the [P1 component catalog](https://components.p1.pantheon.io/).
