---
"@pantheon-systems/create-p1-starter-kit": minor
---

**[Feature]** Scaffolding now asks whether to include the P1 component library, and either answer leaves the project ready to add blocks later.

### What Changed

- A new prompt, `Include the P1 starter component library?`, defaulted to yes. `--blocks` and `--no-blocks` set it without the prompt, and `--yes` takes the default.
- Answering yes installs a library of marketing, editorial and layout blocks — heroes, pricing tables, FAQs, testimonials, feature grids — into `components/puck/blocks/`. They need no Tailwind, and the code is yours: edit it, restyle it, delete what you do not want.
- Answering no scaffolds exactly what it did before.
- Either way the project is configured for the `@p1` registry, so any block can be added later with one command and no URL to look up:

  ```bash
  pnpm dlx shadcn@latest add @p1/pricing
  ```

- Registering a block is a few lines pasted into `components/puck/blocks/index.ts`, which your Puck config already spreads. The install prints them, and each block's catalog card carries the same lines:

  ```ts
  import { PricingBlock } from "./pricing/pricing.block";

  P1Pricing: PricingBlock,  // add to p1Blocks

  // in p1Categories — create the entry if it does not exist yet:
  p1Convert: { title: "P1 Convert", components: ["P1Pricing"] },
  // or, if p1Convert already exists, add to its components array (no duplicate key):
  // p1Convert: { title: "P1 Convert", components: ["P1Pricing", "P1CTA"] },
  ```

- The category line is what puts the block in the editor drawer. A block registered in `p1Blocks` alone still works, but stays out of the drawer with no error.
- Repeat for each block you want. A block's export name is at the top of `components/puck/blocks/<name>/<name>.block.tsx` and does not always match the directory — `@p1/logos` exports `LogoCloudBlock`.
- Your own blocks keep their names. Component keys are prefixed `P1` and categories `p1`, so nothing the starter kit ships is shadowed.
- To review our changes to a block you have already edited, name the file — an item's summary shows only its first few:

  ```bash
  pnpm dlx shadcn@latest add @p1/pricing --diff components/puck/blocks/pricing/pricing.tsx
  ```

- A registry that cannot be reached warns and continues. The project still scaffolds, `components.json` is still written, and the two commands above finish the job whenever you are ready.

### Migration / Action Required

*Only for projects scaffolded with an earlier version.* Nothing back-fills them, and `shadcn add @p1/…` fails with `Unknown registry "@p1"` until `components.json`, the `@/*` path alias and the blocks barrel are all in place. One command writes all three:

```bash
npx @pantheon-systems/p1-next-sdk enable-registry
```

It ships with `@pantheon-systems/p1-next-sdk` and skips anything already there. It does not touch `puck.config.tsx` — spread `p1Categories` and `p1Blocks` as the *first* entry of `categories` and `components` yourself, since later keys win in an object literal and a spread placed last lets a registry category overwrite one of yours, leaving the blocks registered but absent from the drawer. The command prints the lines.
