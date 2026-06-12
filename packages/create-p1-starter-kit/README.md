# @pantheon-systems/create-p1-starter-kit

Scaffold a new P1 starter project with Puck editor and Content Publisher CMS integration.

## Usage

```bash
# Using pnpm
pnpm create @pantheon-systems/p1-starter-kit my-app

# Using npm
npm create @pantheon-systems/p1-starter-kit my-app

# Using yarn
yarn create @pantheon-systems/p1-starter-kit my-app
```

The CLI will prompt you for:
- **Project name** - defaults to the directory name argument
- **Package manager** - auto-detects pnpm/npm/yarn, allows override
- **Git initialization** - creates a git repo with initial commit
- **Dependency installation** - runs install immediately

## What's Included

The scaffolded project includes:

- **Next.js 16 App Router** - Server components and modern routing
- **Puck Editor** - Visual drag-and-drop page builder at `/p1/<path>`
- **Content Publisher Integration** - CMS with datasource bindings
- **Pre-built Blocks** - Typography, media, layout, and action components
- **Tailwind CSS v4** - Utility-first styling
- **TypeScript** - Full type safety
- **Vitest** - Fast unit testing
- **ESLint** - Code linting

## Getting Started

After scaffolding your project:

1. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and fill in:
   # - PCC_SITE_ID: Your Content Cloud site ID
   # - PCC_TOKEN: API token for your site
   # - NEXT_PUBLIC_CSS_BASE_URL: CSS API base URL
   # - NEXT_PUBLIC_CSS_SITE_ID: Site identifier (UUID)
   # - P1_CSS_API_KEY: Server-side API key
   ```

2. **Start the dev server:**
   ```bash
   pnpm dev
   ```

3. **Open your browser:**
   - Site: http://localhost:3000
   - Dashboard: http://localhost:3000/p1
   - Editor: http://localhost:3000/p1/your-page-path

## Project Structure

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

- **Add blocks:** Create components in `components/puck/`, register in `puck.config.tsx`
- **Add datasources:** Define in `lib/` and register for use in blocks
- **Styling:** Edit Tailwind config or component styles

## Troubleshooting

### Module resolution errors

If Next.js can't resolve packages, verify `next.config.mjs` includes:
```js
transpilePackages: [
  "@pantheon-systems/css-client",
  "@pantheon-systems/puck-css",
  "@pantheon-systems/p1-next-sdk",
]
```

## Resources

- [P1 Documentation](https://github.com/pantheon-systems/puck-css-integration)
- [Puck Editor Docs](https://puckeditor.com)
- [Next.js Docs](https://nextjs.org/docs)

## License

MIT
