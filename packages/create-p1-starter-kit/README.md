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
   | `PCC_SITE_ID` | Content Cloud site ID |
   | `PCC_TOKEN` | API token for your site |
   | `NEXT_PUBLIC_CSS_BASE_URL` | CCR API base URL |
   | `NEXT_PUBLIC_CSS_SITE_ID` | Site identifier (UUID) |
   | `CSS_API_KEY` | Server-side API key |

2. **Start the dev server:**

   ```bash
   pnpm dev
   ```

3. **Open:**
   - Site — http://localhost:3000
   - Dashboard — http://localhost:3000/p1
   - Editor — http://localhost:3000/p1/your-page-path

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

- [Pantheon documentation](https://docs.pantheon.io)
- [Puck editor docs](https://puckeditor.com)
- [Next.js docs](https://nextjs.org/docs)

## License

MIT
