# Migration Guide: Environment Variable Consolidation

This guide covers upgrading to `@pantheon/puck-css@0.3.x` which reduces the required environment variables from 6 to 2.

## Breaking: `P1_CSS_API_KEY` renamed to `CSS_API_KEY`

The starter app's server-side API key variable is now `CSS_API_KEY` (previously `P1_CSS_API_KEY`). A single `CSS_API_KEY` is used for all server-side calls, including:

- **Broker authentication** — proxied server-side to authenticate the *site* to the CSS backend (passed as `p1ApiKey` by the app routes and handlers).
- **Server-side content delivery** — read by `createNextContentClient()` when rendering published pages.
- **Template/structure lookups** — sent as an `X-API-Key` header to the CSS backend.

The value is unchanged — it is the same Pantheon site API token (`sat_…` prefix). Only the variable name changed.

> **This is a silent breaking change.** If your environment or deployment secrets still define `P1_CSS_API_KEY` and not `CSS_API_KEY`, `p1ApiKey` resolves to `undefined`, the broker never receives the site token, and editor auth fails — with no build-time error.

### Action required

Rename the variable everywhere it is set — `.env` / `.env.local`, deployment secrets (e.g. Pantheon `web`-scope secrets), and CI configuration:

```diff
-P1_CSS_API_KEY=sat_...
+CSS_API_KEY=sat_...
```

> Note: `CSS_API_KEY` is server-side only. It authenticates the *site*; individual editors still sign in through Auth0 via the broker.

## What Changed

| Variable | Before | After |
|----------|--------|-------|
| `NEXT_PUBLIC_CSS_BASE_URL` | Required | **Required** (unchanged) |
| `NEXT_PUBLIC_CSS_SITE_ID` | Required | **Required** (unchanged) |
| `NEXT_PUBLIC_CSS_AUTH_MODE` | Required | Optional, defaults to `broker` |
| `NEXT_PUBLIC_CSS_ENABLE_REALTIME` | Optional, defaults to `false` | Optional, defaults to `true` |
| `NEXT_PUBLIC_CSS_WS_BASE_URL` | Required when realtime enabled | Optional, derived from `CSS_BASE_URL` |
| `NEXT_PUBLIC_CSS_ENABLE_PRESENCE` | Optional, defaults to `false` | Optional, defaults to `true` |
| `CSS_API_KEY` | For SSR | For SSR (unchanged) |

All existing explicit values continue to work. Setting `NEXT_PUBLIC_CSS_ENABLE_REALTIME=false` still disables realtime.

## Site Code Changes

### 1. Replace `getCSSConfig()` with `createNextConfig()`

`createNextConfig()` reads all `NEXT_PUBLIC_CSS_*` env vars directly. Sites should not re-read env vars and pass them as overrides.

**Before:**
```ts
// lib/css-config.ts
import { createNextConfig } from "@pantheon/puck-css/config";
import type { CSSConfig } from "@pantheon/puck-css/config";

export function getCSSConfig(): CSSConfig {
  return createNextConfig({
    baseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL || "http://localhost:8787",
    siteId: process.env.NEXT_PUBLIC_CSS_SITE_ID || "",
    authMode: (process.env.NEXT_PUBLIC_CSS_AUTH_MODE || "mock") as "mock" | "broker",
    branchId: process.env.NEXT_PUBLIC_CSS_BRANCH_ID,
    enableRealtime: process.env.NEXT_PUBLIC_CSS_ENABLE_REALTIME === "true",
    wsBaseUrl: process.env.NEXT_PUBLIC_CSS_WS_BASE_URL,
    enablePresence: process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE === "true",
  });
}
```

**After:**
```ts
// lib/css-config.ts
import { createNextConfig } from "@pantheon/puck-css/config";

export const cssConfig = createNextConfig();
```

Then update imports from `getCSSConfig()` to `cssConfig`:

```diff
-import { getCSSConfig } from "../lib/css-config";
-const config = getCSSConfig();
+import { cssConfig } from "../lib/css-config";

 // In JSX:
-<CSSApp config={config}>
+<CSSApp config={cssConfig}>
```

### 2. Remove `isCSSConfigured()` / `NEXT_PUBLIC_CSS_ENABLED` gates

Sites may have a feature flag pattern that checks whether CSS is "enabled and configured." These checks often relied on env vars that are no longer required.

**Before:**
```ts
export function isCSSConfigured(): boolean {
  const cssEnabled = process.env.NEXT_PUBLIC_CSS_ENABLED !== "false";
  return (
    cssEnabled &&
    !!process.env.NEXT_PUBLIC_CSS_SITE_ID &&
    (!!process.env.CSS_API_KEY ||
      process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE === "true")
  );
}
```

**After:**

Remove the function entirely. Gate on `NEXT_PUBLIC_CSS_SITE_ID` alone:

```ts
const EditorWithCSSApp = process.env.NEXT_PUBLIC_CSS_SITE_ID
  ? dynamic(() => import("./EditorWithCSSApp"), { ssr: false })
  : null;
```

If the site has a `NEXT_PUBLIC_CSS_ENABLED` env var, remove it. CSS is enabled when `NEXT_PUBLIC_CSS_SITE_ID` is set.

### 3. Remove redundant boolean overrides

If the site was passing `enableRealtime` or `enablePresence` to `createCSSConfig` or `createNextConfig`, remove them. They default to `true`.

**Before:**
```ts
createCSSConfig(import.meta.env, {
  prefix: 'VITE_',
  overrides: {
    enableRealtime: import.meta.env.VITE_CSS_ENABLE_REALTIME !== 'false',
    enablePresence: import.meta.env.VITE_CSS_ENABLE_PRESENCE !== 'false',
  },
});
```

**After:**
```ts
createCSSConfig(import.meta.env, { prefix: 'VITE_' });
```

To explicitly disable a feature, set the env var to `false` — no code changes needed:
```
NEXT_PUBLIC_CSS_ENABLE_REALTIME=false
```

### 4. Remove `wsBaseUrl` from env files

`wsBaseUrl` is now derived from `baseUrl` automatically (`http://` becomes `ws://`, `https://` becomes `wss://`). Remove it from `.env` files unless you need a different WebSocket endpoint than your API server.

**Before (.env):**
```
NEXT_PUBLIC_CSS_BASE_URL=https://css.example.com
NEXT_PUBLIC_CSS_WS_BASE_URL=wss://css.example.com
```

**After (.env):**
```
NEXT_PUBLIC_CSS_BASE_URL=https://css.example.com
```

### 5. Remove `CSS_AUTH_MODE` from env files (if using the default)

`broker` is now the default. Only set `NEXT_PUBLIC_CSS_AUTH_MODE` if you need a different auth mode:

```
# Only needed for non-default auth:
NEXT_PUBLIC_CSS_AUTH_MODE=mock
NEXT_PUBLIC_CSS_AUTH_MODE=broker
```

## Minimum .env After Migration

```
NEXT_PUBLIC_CSS_BASE_URL=https://css.example.com
NEXT_PUBLIC_CSS_SITE_ID=your-site-id
```

That's it. Realtime, presence, WebSocket URL, and auth mode are all handled automatically.

## Pantheon Secrets

For deployed sites using Pantheon secrets, the following variables can be removed from the `ic` scope:

- `NEXT_PUBLIC_CSS_AUTH_MODE` (unless overriding the default)
- `NEXT_PUBLIC_CSS_ENABLE_REALTIME`
- `NEXT_PUBLIC_CSS_WS_BASE_URL`
- `NEXT_PUBLIC_CSS_ENABLE_PRESENCE`

Remaining required secrets:

| Variable | Scope | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_CSS_BASE_URL` | ic | Baked into bundle at build time |
| `NEXT_PUBLIC_CSS_SITE_ID` | ic | Baked into bundle at build time |
| `CSS_API_KEY` | web | Server-side content delivery |
