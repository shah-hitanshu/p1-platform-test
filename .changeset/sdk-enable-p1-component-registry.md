---
"@pantheon-systems/p1-next-sdk": minor
---

**[Feature]** `p1-next-sdk` is now a unified dispatcher with two subcommands: `migrate` (was the standalone `p1-migrate` binary) and `enable-registry` (new).

### What Changed

- `npx @pantheon-systems/p1-next-sdk enable-registry [dir]` writes `components.json`, creates `components/puck/blocks/index.ts`, and adds the `@/*` path alias to `tsconfig.json`, so `shadcn add @p1/…` works in a project scaffolded before the registry existed. Previously this was three files to write by hand.
- Your files are not rewritten. A `components.json` you already have gains only the `registries` entry for `@p1`, leaving every other key as it is; the barrel, `tsconfig.json` and `puck.config.tsx` are skipped when already in place. A second run reports what it found and changes nothing.
- `tailwind.css` points at the stylesheet your project actually has (`app/globals.css`, `src/app/globals.css` or `styles/globals.css`). When there is none to find, the command says so instead of naming a file that does not exist and leaving blocks unstyled.
- A `tsconfig.json` is edited as text rather than parsed and rewritten, so comments and formatting survive. One with no `paths` block to extend is reported with the lines to add, rather than restructured.
- `puck.config.tsx` is never touched — it is yours, and you have edited it. The two spreads to add are printed, along with why both must come first.
- `p1-migrate` is no longer a standalone binary. Use `p1-next-sdk migrate` instead.
