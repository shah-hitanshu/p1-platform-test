# Puck CSS Integration

Integration between [Puck Editor](https://puckeditor.com) and the Collaborative State System (CSS) for building visual page editors with version control, branching, and publishing workflows.

## Features

- **Auto-save** - Automatic saving with configurable debounce (default 3 seconds)
- **Version History** - Every save creates a new document version
- **Branching** - Work on different branches with easy switching
- **Publishing** - Create checkpoints (named snapshots) for releases
- **Conflict Detection** - Detect and resolve merge conflicts between branches
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

| Variable | Required | Side | Description |
|----------|----------|------|-------------|
| `NEXT_PUBLIC_CSS_BASE_URL` | Yes | Client+Server | CSS API base URL |
| `NEXT_PUBLIC_CSS_SITE_ID` | Yes | Client+Server | Site identifier |
| `NEXT_PUBLIC_CSS_AUTH_MODE` | Yes | Client | Auth mode: `mock`, `google`, or `auth0` |
| `NEXT_PUBLIC_CSS_GOOGLE_CLIENT_ID` | If google auth | Client | Google OAuth client ID |
| `NEXT_PUBLIC_CSS_BRANCH_ID` | No | Client+Server | Branch ID (defaults to main) |
| `NEXT_PUBLIC_CSS_ENABLE_REALTIME` | No | Client | Enable real-time collaboration (`true`/`false`) |
| `NEXT_PUBLIC_CSS_WS_BASE_URL` | If realtime | Client | WebSocket URL for real-time |
| `NEXT_PUBLIC_CSS_ENABLE_PRESENCE` | No | Client | Enable presence awareness (`true`/`false`) |
| `CSS_API_KEY` | For SSR | Server | API key for server-side content delivery |

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

Real-time collaboration is config-only. Set the environment variables and `CSSApp` handles all wiring internally:

```
NEXT_PUBLIC_CSS_ENABLE_REALTIME=true
NEXT_PUBLIC_CSS_WS_BASE_URL=ws://your-server:port
```

Multiple users editing the same document will see each other's changes merged automatically via Yjs CRDT.

If you are building custom UI with `useCSSEditor`, the `realtimeConnected` property is available for displaying connection status.

## Presence

Presence awareness is also config-only:

```
NEXT_PUBLIC_CSS_ENABLE_PRESENCE=true
```

`CSSApp` includes presence UI automatically:

- **Collaborator avatars** — stacked avatar display of online users and agents
- **Agent activity banner** — shown when an AI agent is actively editing
- **Focus region highlighting** — outlines the component another user has selected, with a badge showing their initial. Applied via CSS to Puck's existing DOM elements with zero impact on scroll or performance

## Branch Merge Comparison

When working on a non-main branch, the CSS plugin panel shows a "Compare with main" link below the branch selector. By default, `useCSSEditor` navigates to `/merge?branch={branchId}` — your app needs a route at `/merge` to handle this.

To customize the navigation (e.g., use a router push or a different URL pattern), pass `onMergeCompare` via `pluginOptions`. The callback receives the main branch ID as its argument:

```tsx
const { puckKey, puckProps } = useCSSEditor({
  documentPath: '/home',
  puckConfig,
  pluginOptions: {
    onMergeCompare: (mainBranchId) => {
      router.push(`/merge?target=${mainBranchId}`);
    },
  },
});
```

If you are using the lower-level `useCSSPlugin` or `createCSSPlugin` directly, you must provide `onMergeCompare` yourself — no default is set at that layer:

```tsx
const plugin = useCSSPlugin({
  onMergeCompare: (mainBranchId) => {
    window.location.assign(`/merge?target=${mainBranchId}`);
  },
});
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
    demo/            # Demo application (run with: cd apps/demo && pnpm dev)
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
