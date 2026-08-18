# @pantheon-systems/p1-starter-components

A library of 37 Puck blocks — marketing, editorial, and layout — for P1 starter
projects. Migrated from `pantheon-systems/p1-starter-components` (PCC-3580).

## Storybook

```bash
pnpm --filter @pantheon-systems/p1-starter-components storybook
```

Published from `main` to GitHub Pages. Viewing it requires a Pantheon GitHub
login.

## Layout

- `src/blocks/` — one `ComponentConfig` per file, 37 in total.
- `src/internal/` — shared helpers (`Btn`, icons, rich-text). Not blocks, not exported.
- `src/styles/variables.css` — design tokens. Override these in a consuming project.
- `src/index.ts` — named exports plus `marketingBlocks` and `secondaryLibraryCategories`.

## Status

Private and unpublished. Tailwind is still a dependency; removing it is
PCC-3580 phase 2, and publishing to npm is phase 3.
