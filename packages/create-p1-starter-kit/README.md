# @pantheon-systems/create-p1-starter-kit

Scaffold a new P1 project — a Next.js app with the Puck visual editor and Pantheon Content
Publisher integration wired up and ready to run.

## Usage

```bash
# pnpm
pnpm create @pantheon-systems/p1-starter-kit my-app

# npm
npm create @pantheon-systems/p1-starter-kit my-app

# yarn
yarn create @pantheon-systems/p1-starter-kit my-app
```

The CLI prompts for:

- **Project name** — defaults to the directory name argument
- **Package manager** — auto-detects pnpm/npm/yarn, allows override
- **Git initialization** — creates a repo with an initial commit
- **Dependency installation** — runs install immediately

## What's included

- **Next.js 16 App Router** — server components and modern routing
- **Puck editor** — visual drag-and-drop page building at `/p1/<path>`
- **Content Publisher integration** — CMS with datasource bindings
- **Pre-built blocks** — typography, media, layout, and action components
- **The P1 component library** — optional marketing, editorial and layout blocks ([browse the catalog](https://components.p1.pantheon.io/))
- **Tailwind CSS v4**, **TypeScript**, **Vitest**, **ESLint**

## Getting started

After scaffolding:

1. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Fill in:

   | Variable | Purpose |
   | --- | --- |
   | `NEXT_PUBLIC_CSS_SITE_ID` | Site identifier (UUID) |
   | `CSS_API_KEY` | Server-side API key |

   Everything else in `.env.example` is commented out and optional, including the
   `PCC_SITE_ID`/`PCC_TOKEN` pair for Content Publisher.

2. **Start the dev server:**

   ```bash
   pnpm dev
   ```

3. **Open:**
   - Site — http://localhost:3000
   - Dashboard — http://localhost:3000/p1
   - Editor — http://localhost:3000/p1/your-page-path

## The P1 component library

Scaffolding asks:

```
Include the P1 starter component library?  (Y/n)
```

**Yes** (the default) installs a library of marketing, editorial and layout blocks — heroes, pricing
tables, FAQs, testimonials, feature grids — into `components/puck/blocks/`. They need no Tailwind,
and the code is yours: edit it, restyle it, delete what you do not want. Using one takes three lines
in `components/puck/blocks/index.ts` — see below, and repeat for each block you want.

**No** scaffolds exactly what it did before. Either way the project is configured for the `@p1`
registry, so you can add blocks whenever you like.

Browse everything available, with the exact command for each block, in the
**[P1 component catalog](https://components.p1.pantheon.io/)**.

### Adding a block later

```bash
pnpm dlx shadcn@latest add @p1/pricing
```

The install prints the lines to paste into `components/puck/blocks/index.ts`:

```ts
import { PricingBlock } from "./pricing/pricing.block";

P1Pricing: PricingBlock,  // add to p1Blocks

// in p1Categories — create the entry if it does not exist yet:
p1Convert: { title: "P1 Convert", components: ["P1Pricing"] },
// or, if p1Convert already exists, add to its components array (no duplicate key):
// p1Convert: { title: "P1 Convert", components: ["P1Pricing", "P1CTA"] },
```

The category line is what puts the block in the editor drawer. A block registered in `p1Blocks`
alone still works, but stays out of the drawer with no error. Repeat for each block you want — a
block's export name is at the top of `components/puck/blocks/<name>/<name>.block.tsx` and does not
always match the directory.

### Reviewing our updates to a block you have edited

```bash
pnpm dlx shadcn@latest add @p1/pricing --diff components/puck/blocks/pricing/pricing.tsx
```

Name the file. An item's summary shows only its first few, so a bare `--diff` may not reach the one
you changed.

### Projects scaffolded before this release

They have no `components.json`, no `@/*` path alias and no blocks barrel, and nothing back-fills
them — `add` fails with `Unknown registry "@p1"` until all three exist. One command writes all
three:

```bash
npx @pantheon-systems/p1-next-sdk enable-registry
```

It ships with [`@pantheon-systems/p1-next-sdk`](https://www.npmjs.com/package/@pantheon-systems/p1-next-sdk),
skips anything already in place, and edits `tsconfig.json` as text so comments survive.

It stops short of `puck.config.tsx`, which is yours and which you have edited. Spread the barrel
there by hand, both entries **first**:

```tsx
import { p1Blocks, p1Categories } from "./components/puck/blocks";

categories: { ...p1Categories, /* your own categories after */ },
components: { ...p1Blocks,     /* your own blocks after */ },
```

Order matters: later keys win in an object literal, so a spread placed last lets a registry category
overwrite one of yours, and the blocks disappear from the drawer while staying registered.

## Project structure

```
my-app/
├── app/
│   ├── page.tsx                  # Site root
│   ├── [...puckPath]/            # Published pages
│   └── p1/
│       ├── page.tsx              # Dashboard
│       ├── [[...p1]]/            # Editor & renderer
│       ├── api/[...p1]/          # API routes
│       └── auth/[...action]/     # Auth routes
├── components/puck/              # Block definitions
├── lib/                          # Datasources and utilities
├── puck.config.tsx               # Puck configuration
└── .env.example                  # Environment template
```

## Customization

- **Add blocks** — create components in `components/puck/`, register them in `puck.config.tsx`
- **Add datasources** — define in `lib/` and register for use in blocks
- **Styling** — edit the Tailwind config or component styles

Your scaffolded project also includes an optional `scripts/sync-puck-registry.ts` for syncing
the component registry from CI, with a sample workflow in `ci-examples/`. It is inert until you
wire it up; see the comments in those files for setup.

## Troubleshooting

**Module resolution errors.** Next.js needs the P1 packages transpiled. Verify
`next.config.mjs` includes:

```js
transpilePackages: [
  "@pantheon-systems/css-client",
  "@pantheon-systems/puck-css",
  "@pantheon-systems/p1-next-sdk",
],
```

## Resources

- [P1 component catalog](https://components.p1.pantheon.io/)
- [Pantheon documentation](https://docs.pantheon.io)
- [Puck editor docs](https://puckeditor.com)
- [Next.js docs](https://nextjs.org/docs)

## License

MIT
