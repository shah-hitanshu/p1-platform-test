# Content Publisher Site Sample

A sample Next.js site demonstrating the Content Publisher CMS — Pantheon's visual page-building and content management system. Content Publisher combines a Puck-based drag-and-drop editor with server-side datasource resolution, enabling authors to build dynamic, data-driven pages without writing code.

## What's included

- **Visual page editor** — Puck-powered drag-and-drop editing at `/p1/<path>` with built-in blocks for typography, media, layout, and actions
- **Site structure management** — Dashboard at `/p1` for creating and organizing pages and templates
- **Datasource bindings** — Connect page blocks to live data from Content Publisher articles, external APIs (SWAPI, Pokemon GraphQL), and URL route parameters
- **Next.js App Router** — Server components, catch-all routing, and API route handlers via `@pantheon-systems/p1-client-sdk`

## Getting started

1. Copy the environment file and fill in your credentials:

   ```
   cp .env.example .env
   ```

   | Variable      | Description                |
   | ------------- | -------------------------- |
   | `PCC_SITE_ID` | Your Content Cloud site ID |
   | `PCC_TOKEN`   | API token for your site    |

2. Install dependencies and start the dev server:

   ```
   npm install
   npm run dev
   ```

3. Open http://localhost:3000 to view the site, or http://localhost:3000/p1 for the page management dashboard.

## Project structure

```
app/
  page.tsx                    # Site root (renders via Puck)
  [...puckPath]/              # Catch-all route for published pages
  p1/
    page.tsx                  # P1 dashboard — lists pages, links to editor
    [...p1]/                  # Editor & renderer for any page path
    api/[...p1]/route.ts      # API handler (GET/POST/DELETE) for page data
components/puck/              # Block definitions (Heading, Paragraph, Image, etc.)
lib/builtin-datasources.ts    # Datasource registry (SWAPI, Pokemon, articles, URL params)
puck.config.tsx               # Puck editor configuration — block registry & categories
```

## Customization

- **Add blocks** — Create a new component in `components/puck/`, then register it in `puck.config.tsx`
- **Add datasources** — Define a new `DatasourceDefinition` in `lib/builtin-datasources.ts` to make external data available to block fields via `{{ datasource.field }}` expressions
- **Change styling** — The project uses Tailwind CSS v4; edit `app/styles.css` or individual block components
