# Puck CSS Integration

Integration between [Puck Editor](https://puckeditor.com) and the Collaborative State System (CSS) for building visual page editors with version control, branching, and publishing workflows.

## Features

- **Auto-save** - Automatic saving with configurable debounce (default 3 seconds)
- **Version History** - Every save creates a new document version
- **Branching** - Work on different branches with easy switching
- **Publishing** - Create checkpoints (named snapshots) for releases, with published status indicators
- **Visual Merge Review** - Built-in overlay for reviewing and resolving branch merge conflicts with side-by-side previews
- **User Attribution** - Track who made each change
- **Real-time Collaboration** - Multiple users can edit simultaneously with Yjs CRDT sync
- **Presence Awareness** - See who's viewing/editing documents in real-time
- **Agent Politeness** - AI agents can edit documents while respecting human presence

## Packages

| Package | Description |
|---------|-------------|
| `@pantheon/css-client` | TypeScript API client for the Collaborative State System |
| `@pantheon/puck-css` | React hooks and components for Puck editor integration |

## Installation

```bash
# Using pnpm
pnpm add @pantheon/css-client @pantheon/puck-css

# Using npm
npm install @pantheon/css-client @pantheon/puck-css

# Using yarn
yarn add @pantheon/css-client @pantheon/puck-css
```

## Quick Start

### Vite Example

**Step 1 - Config:**

```ts
// css.config.ts
import { createCSSConfig } from '@pantheon/puck-css/config';

export const cssConfig = createCSSConfig(import.meta.env, { prefix: 'VITE_' });
```

**Step 2 - App wrapper:**

```tsx
// App.tsx
import { Puck } from '@puckeditor/core';
import { CSSApp, useCSSEditor } from '@pantheon/puck-css';
import { cssConfig } from './css.config';
import puckConfig from './puck.config';
import '@pantheon/puck-css/styles.css';

function Editor() {
  const { loading, error, puckKey, puckProps } = useCSSEditor({
    documentPath: '/home',
    puckConfig,
  });
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  return <Puck key={puckKey} {...puckProps} />;
}

export default function App() {
  return (
    <CSSApp config={cssConfig}>
      <Editor />
    </CSSApp>
  );
}
```

### Next.js Example

**Step 1 - next.config.js:**

Add `@pantheon/puck-css` to `transpilePackages` if you encounter module resolution issues:

```js
// next.config.js
const nextConfig = {
  transpilePackages: ['@pantheon/puck-css'],
};
module.exports = nextConfig;
```

**Step 2 - Config:**

```ts
// lib/css.config.ts
import { createNextConfig } from '@pantheon/puck-css/config';

export const cssConfig = createNextConfig();
// That's it! References NEXT_PUBLIC_CSS_* env vars at build time.
```

**Step 3 - Editor page (client component):**

```tsx
'use client';
import { Puck } from '@puckeditor/core';
import { CSSApp, useCSSEditor } from '@pantheon/puck-css';
import { cssConfig } from '@/lib/css.config';
import puckConfig from '@/puck.config';
import '@pantheon/puck-css/styles.css';

function Editor({ documentPath }: { documentPath: string }) {
  const { loading, error, puckKey, puckProps } = useCSSEditor({
    documentPath,
    puckConfig,
  });
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  return <Puck key={puckKey} {...puckProps} />;
}

export default function EditorPage() {
  return (
    <CSSApp config={cssConfig}>
      <Editor documentPath="/home" />
    </CSSApp>
  );
}
```

**Step 4 - Public page (server component):**

```tsx
// app/[[...slug]]/page.tsx
import { createNextContentClient } from '@pantheon/puck-css/config';
import { Render } from '@puckeditor/core';
import puckConfig from '@/puck.config';

const content = createNextContentClient();

export default async function Page({ params }: { params: { slug?: string[] } }) {
  const path = '/' + (params.slug?.join('/') || '');
  const page = await content?.getPage(path);
  if (!page) return notFound();
  return <Render config={puckConfig} data={page.data} />;
}
```

## Environment Variables

### Required

Only two environment variables are required:

| Variable | Side | Description |
|----------|------|-------------|
| `NEXT_PUBLIC_CSS_BASE_URL` | Client+Server | CSS API base URL (e.g. `https://css.example.com`) |
| `NEXT_PUBLIC_CSS_SITE_ID` | Client+Server | Site identifier (UUID) |

### Optional

Everything else has sensible defaults and can be omitted.

**Features** — enabled by default, set to `false` to disable:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_CSS_ENABLE_REALTIME` | `true` | Real-time collaborative editing via WebSocket/Yjs CRDT |
| `NEXT_PUBLIC_CSS_ENABLE_PRESENCE` | `true` | Presence awareness (collaborator avatars, focus highlighting) |

**Authentication** — defaults to broker auth (proxied server-side via `CSS_API_KEY`):

> **Advanced:** Set `NEXT_PUBLIC_CSS_AUTH_MODE=mock` to use demo users for local development without a real auth backend. Do not set this in production.

**Networking** — derived from `BASE_URL` when not set:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_CSS_WS_BASE_URL` | Derived from `BASE_URL` | WebSocket URL (`http→ws`, `https→wss`). Override for a separate WS endpoint. |
| `NEXT_PUBLIC_CSS_BRANCH_ID` | main branch | Target branch for document operations |

**Server-side** — only needed for server-rendered public pages:

| Variable | Description |
|----------|-------------|
| `CSS_API_KEY` | API key for `createNextContentClient()`. Returns `null` if not set. |

**Note:** `CSS_API_KEY` is a Pantheon site API token (`sat_…`), server-side only. A single value backs every server-side use — broker authentication (above), content delivery, and template lookups. It authenticates the *site*; editors still sign in through Auth0.

**Note:** For Vite apps, use the `VITE_` prefix instead of `NEXT_PUBLIC_` (e.g. `VITE_CSS_BASE_URL`).

## Server-Side Content Delivery

Use `createNextContentClient()` to fetch published content in server components or API routes:

```ts
import { createNextContentClient } from '@pantheon/puck-css/config';

const client = createNextContentClient();
const page = await client?.getPage('/about');
```

This reads `CSS_API_KEY`, `NEXT_PUBLIC_CSS_BASE_URL`, and `NEXT_PUBLIC_CSS_SITE_ID` from the server environment. Returns `null` if required variables are missing.

## Real-time Collaboration

Real-time collaboration is enabled by default. `CSSApp` handles all wiring internally — the WebSocket URL is derived from `NEXT_PUBLIC_CSS_BASE_URL` automatically.

To disable real-time collaboration:

```
NEXT_PUBLIC_CSS_ENABLE_REALTIME=false
```

To use a custom WebSocket URL (e.g. a separate WebSocket server):

```
NEXT_PUBLIC_CSS_WS_BASE_URL=wss://custom-ws-server:port
```

Multiple users editing the same document will see each other's changes merged automatically via Yjs CRDT.

If you are building custom UI with `useCSSEditor`, the `realtimeConnected` property is available for displaying connection status.

### Action Metadata

`CSSPuckProvider` captures Puck editor action metadata (action type, component type, component ID, zone, etc.) via an `onAction` handler and exposes it as `handleAction` on the context. When real-time is enabled, `RealtimeClient.applyLocalChange` accepts optional action metadata. After sending a binary CRDT update, the client sends the metadata as a JSON text message (`{ type: 'action_metadata', actionType, actionMetadata }`) over the WebSocket. The backend uses this metadata to build rich version history with human-readable change descriptions.

When real-time is enabled, publishing is coordinated through the WebSocket connection. This ensures all pending CRDT updates are flushed to the server before the checkpoint is created, eliminating stale-version races. If the WebSocket is disconnected, publishing falls back to the standard HTTP API automatically.

## Presence

Presence awareness is enabled by default. To disable:

```
NEXT_PUBLIC_CSS_ENABLE_PRESENCE=false
```

`CSSApp` includes presence UI automatically:

- **Collaborator avatars** — stacked avatar display of online users and agents
- **Agent activity banner** — shown when an AI agent is actively editing
- **Focus region highlighting** — outlines the component another user has selected, with a badge showing their initial. Applied via CSS to Puck's existing DOM elements with zero impact on scroll or performance

## Merge Review

When working on a Draft branch (any non-main branch), the CSS plugin panel shows a **"Compare with Live"** button below the branch selector. Clicking it opens a built-in full-screen overlay for reviewing and merging changes — no additional route or page is required.

The merge review overlay provides:

- **Document categorization** — changed, added, and deleted documents are grouped automatically
- **Resolution strategies** — for each document, choose Accept Draft, Accept Live, Cherry-pick (per-field selection), or Auto merge (when real-time collaboration state is available)
- **Visual previews** — side-by-side, overlay, or slider views for comparing Draft and Live versions at 25% scale
- **Bulk actions** — accept all remaining conflicts from Draft or Live in one click
- **Keyboard navigation** — arrow keys to move between documents, shortcuts for resolution strategies

The overlay activates automatically when `puckConfig` is provided to the plugin. Documents where Draft and Live versions are identical are silently skipped to reduce noise.

The UI uses **Live/Draft terminology**: the main branch is labeled "Live" and working branches are labeled "Draft" throughout the editor interface, including the branch selector, merge review, and status indicators.

## Component Drawer Thumbnails

Pass a `thumbnails` map to `useCSSEditor` to show schematic SVG wireframe thumbnails alongside each component name in the Puck drawer. Thumbnails make components immediately distinguishable at small sizes without any screenshot capture, CORS dependencies, or build-time assets.

### 1. Generate the thumbnail file

Run the bundled generator script once, and again whenever you add or rename components:

```bash
pnpm generate-thumbnails
# or: npx tsx scripts/generate-thumbnails.ts
```

The script reads your `puck.config.tsx`, infers a layout for each component from its name, and writes `lib/component-thumbnails.tsx`. Refine any auto-generated stubs by editing the SVG geometry in that file.

> **Note:** Components registered via object spread (e.g. `...pccConfigs`) are not captured by the regex parser and will fall back to the generic placeholder. Add their names manually to the output file if needed.

### 2. Wire into `useCSSEditor`

```tsx
import { THUMBNAIL_MAP } from '@/lib/component-thumbnails';

const { puckKey, puckProps } = useCSSEditor({
  documentPath,
  puckConfig,
  thumbnails: THUMBNAIL_MAP,  // ← one line, everything else is handled
});
```

That's it. The package handles the drawer layout (thumbnail + name + drag-handle grip), the fallback placeholder for unmapped names, and stable memoisation to prevent unnecessary Puck re-renders.

### 3. CI/CD automation (GitHub Actions)

Add a step that regenerates thumbnails when your Puck config changes:

```yaml
- name: Regenerate component thumbnails
  if: |
    contains(github.event.head_commit.modified, 'puck.config.tsx') ||
    contains(github.event.head_commit.modified, 'components/puck/')
  run: npx tsx scripts/generate-thumbnails.ts

- name: Commit updated thumbnails
  run: |
    git config user.name  "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add lib/component-thumbnails.tsx
    git diff --cached --quiet || git commit -m "chore: regenerate component thumbnails"
    git push
```

### How it works

Thumbnails are pure SVG rendered inline — no canvas capture, no external images, no async loading. Each component gets a 60×40 viewBox wireframe that encodes its layout semantics (image areas, text columns, navigation bars, etc.) using a small set of SVG primitives. The SVG scales cleanly to any display size and DPR.

The `thumbnails` option slots into the override merge chain between the CSS overrides and any `additionalOverrides`, so a site can still fully replace `drawerItem` if needed.

### Type

```ts
import type { ThumbnailMap } from '@pantheon/puck-css';

// ThumbnailMap = Record<string, React.FC>
// Each value is a zero-argument React component that renders an SVG.
```

## Advanced: Low-Level API

For apps that need full control over the CSS integration, you can use the provider and hook directly instead of `CSSApp`:

```tsx
import { CSSClient } from '@pantheon/css-client';
import { CSSPuckProvider, useCSSPuck } from '@pantheon/puck-css';

const client = new CSSClient({ baseUrl: '...', apiKey: '...' });

function App() {
  return (
    <CSSPuckProvider
      client={client}
      siteId="your-site-id"
      userId="current-user-id"
      enableRealtime={true}
      wsBaseUrl="wss://your-server"
      presenceEnabled={true}
    >
      <Editor />
    </CSSPuckProvider>
  );
}

function Editor() {
  const {
    currentData, loadDocument, saveData, saveStatus,
    branches, currentBranch, switchBranch,
    realtimeConnected, presence, createCheckpoint,
  } = useCSSPuck();

  useEffect(() => { loadDocument('/home'); }, [loadDocument]);

  if (!currentData) return <div>Loading...</div>;

  return (
    <Puck config={puckConfig} data={currentData} onChange={saveData} />
  );
}
```

See the full `useCSSPuck` and `CSSPuckProvider` API in the package source for all available props and context values.

## Upgrading PDSv2

`pds-core.css` is embedded at build time as a TypeScript string (`src/pds/theme/pds-core-content.ts`) and injected via `document.adoptedStyleSheets` in `CSSApp.tsx`. This keeps PDS global styles out of Puck's canvas iframe without requiring a host-app CSS import.

Because of this, bumping `@pantheon-systems/pds-toolkit-react` requires a rebuild of `puck-css` to pick up the new CSS:

```bash
# 1. Update the version in packages/puck-css/package.json, then:
cd packages/puck-css
pnpm install
pnpm build   # copies pds-core.css and regenerates pds-core-content.ts

# 2. Commit the regenerated file alongside the version bump
git add src/pds/theme/pds-core-content.ts src/pds/theme/pds-core.css package.json
git commit -m "chore(pds): upgrade pds-toolkit-react to <version>"
```

If you skip the rebuild, the embedded CSS stays at the old version even though the package.json reference is updated.

## Upgrading to 0.8 (persistent editor)

`@pantheon-systems/p1-next-sdk@0.8` renders the P1 editor from a persistent layout in an `(editor)` route group instead of the catch-all page, so navigating between documents no longer remounts the whole editor. This is a breaking change for existing apps — an upgraded app that keeps the old page-only route renders a blank editor.

A codemod restructures an existing app for you:

```bash
npx @pantheon-systems/p1-next-sdk p1-migrate
```

See [docs/MIGRATION-EDITOR-LAYOUT.md](docs/MIGRATION-EDITOR-LAYOUT.md) for the full guide, the `--dry-run`/`--force` options, and the manual steps.

## Development

### Prerequisites

- Node.js 18+
- pnpm 9+

### Setup

```bash
pnpm install
pnpm test
pnpm lint
pnpm build
```

### Project Structure

```
puck-css-integration/
  packages/
    css-client/      # @pantheon/css-client - TypeScript API client
    puck-css/        # @pantheon/puck-css - React integration
  apps/
    p1-starter/      # P1 Starter application (run with: cd apps/p1-starter && pnpm dev)
```

## Troubleshooting

### Real-time Collaboration Issues

**WebSocket connection not established**
- Verify the document has loaded (`currentDocument` must be non-null before connection starts)
- Confirm environment variables are set correctly
- Ensure `enableRealtime` evaluates to boolean `true`, not the string `"true"`

**WebSocket connection fails**
- Verify the CSS backend is running and supports WebSocket connections
- Check that `wsBaseUrl` uses `ws://` for HTTP or `wss://` for HTTPS
- Ensure CORS is configured on the backend
- Check browser console for WebSocket errors

**Changes not syncing between users**
- Verify both users show `realtimeConnected === true`
- Ensure both users are on the same branch and document path
- If using the low-level API, ensure `remoteSyncKey` is included in your sync key calculation

### General Issues

**Document not loading**
- Check that `siteId` and `branchId` are correct
- Verify the document exists on the specified branch
- Check the browser network tab for API errors

**Auto-save not working**
- Verify `autoSaveDelay` is set (default: 3000ms)
- Check that `saveData` is being called from Puck's `onChange`
- Look for errors in the browser console

**Version history not showing**
- Ensure `useVersions` hook is provided with valid `documentId`
- Check that versions exist for the document (first save creates version 1)

### Next.js-Specific Issues

**`process.env` dynamic access does not work** - Next.js inlines environment variables at build time. Use `createNextConfig()` which handles this correctly. Do not pass `process.env` to `createCSSConfig()` directly.

**Module resolution errors** - Add `@pantheon/puck-css` to `transpilePackages` in `next.config.js`.

**Server components cannot use hooks** - Use `createNextContentClient()` for fetching content in server components. Hooks like `useCSSEditor` and `useCSSPuck` require a client component (`'use client'`).

### Bundler Environment Variable Prefixes

| Bundler | Prefix | Access Pattern |
|---------|--------|----------------|
| Vite | `VITE_` | `import.meta.env.VITE_*` |
| Next.js | `NEXT_PUBLIC_` | `process.env.NEXT_PUBLIC_*` |
| Create React App | `REACT_APP_` | `process.env.REACT_APP_*` |

## License

MIT
