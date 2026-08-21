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

## Status

Private and unpublished. Tailwind removal and npm publishing are planned for later phases.

The `registry.json` currently registers only the `divider` block as a proof-of-concept
for the shadcn distribution pipeline — full population of all 37 blocks is a separate
follow-on commit.
