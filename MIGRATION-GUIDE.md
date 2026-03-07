# Puck CSS Integration Migration Guide

This guide describes how to migrate existing Puck CSS sites from the manual provider wiring pattern to the new `<CSSApp>` + `createCSSConfig` API introduced in `@pantheon/puck-css` Phase 7.

## Overview

The new API eliminates ~70 lines of boilerplate per site by replacing manual `CSSAuthProvider` + `CSSClient` + `CSSPuckProvider` + `FocusHighlightProvider` composition with a single `<CSSApp>` component.

**Before:** Each site manually wires `CSSProviders.tsx` (~95 lines) + `lib/css-config.ts` (~50 lines).
**After:** Each site uses `<CSSApp config={config}>` (~15 lines) + optional thin config wrapper.

## Target Sites

| Site | Location | Framework | Root path mapping | Package source |
|------|----------|-----------|-------------------|----------------|
| airbus.ccapture | `~/Documents/airbus.ccapture` | Next.js 16 | `"/" → "home"` | tarball v0.1.1 |
| my-app | `~/src/my-app` | Next.js 16 | `"/" → "homepage"` | vendored tarball v0.1.2 |

## Prerequisites

Both sites need updated `@pantheon/puck-css` and `@pantheon/css-client` packages that include the new APIs. Build fresh tarballs from the `feature/content-delivery-phase7` branch of `puck-css-integration`:

```bash
cd ~/src/puck-css-integration
git checkout feature/content-delivery-phase7

# Build packages
cd packages/css-client && pnpm build && pnpm pack
cd ../puck-css && pnpm build && pnpm pack
```

Copy the resulting `.tgz` files to each site's `vendor/` directory and update `package.json` references, then reinstall.

## Migration Steps

### Step 1: Update `lib/css-config.ts`

**Delete** the custom `CSSConfig` interface, `getCSSConfig()`, and `toCSSPath()`. Replace with imports from `@pantheon/puck-css`.

Both sites have non-standard env var names that don't follow the `CSS_*` convention (e.g., `NEXT_PUBLIC_AUTH_MODE` instead of `NEXT_PUBLIC_CSS_AUTH_MODE`). Use the `overrides` parameter to handle these.

#### Airbus — `lib/css-config.ts`

**Current** (~47 lines): Custom `CSSConfig` interface, `getCSSConfig()`, `toCSSPath()`.

**Replace with:**

```typescript
import { createCSSConfig, toCSSPath } from "@pantheon/puck-css";
import type { CSSConfig } from "@pantheon/puck-css";

// Re-export toCSSPath for existing call sites
export { toCSSPath };
export type { CSSConfig };

export function getCSSConfig(): CSSConfig {
  return createCSSConfig(
    // Next.js makes NEXT_PUBLIC_* vars available via process.env
    process.env as Record<string, string | undefined>,
    {
      prefix: "NEXT_PUBLIC_",
      overrides: {
        // These env vars don't follow CSS_* naming convention
        authMode: (process.env.NEXT_PUBLIC_AUTH_MODE || "mock") as "mock" | "google" | "auth0",
        googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        // Airbus uses a Next.js proxy at /css-api to avoid CORS
        clientBaseUrl: "/css-api",
      },
    }
  );
}
```

**Important:** Airbus maps `"/" → "home"` which matches the library's `toCSSPath()`. No override needed.

#### my-app — `lib/css-config.ts`

**Current** (~55 lines): Custom `CSSConfig`, `getCSSConfig()`, `toCSSPath()`, `isCSSConfigured()`.

**Replace with:**

```typescript
import { createCSSConfig, toCSSPath as libToCSSPath } from "@pantheon/puck-css";
import type { CSSConfig } from "@pantheon/puck-css";

export type { CSSConfig };

/**
 * my-app maps "/" to "homepage" (not "home" like the library default).
 * Override toCSSPath to preserve this behavior.
 */
export function toCSSPath(routePath: string): string {
  const stripped = routePath.replace(/^\/+/, "");
  return stripped || "homepage";
}

export function getCSSConfig(): CSSConfig {
  return createCSSConfig(
    process.env as Record<string, string | undefined>,
    {
      prefix: "NEXT_PUBLIC_",
      overrides: {
        authMode: (process.env.NEXT_PUBLIC_AUTH_MODE || "mock") as "mock" | "google" | "auth0",
        googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      },
    }
  );
}

/** Whether CSS is enabled and configured */
export function isCSSConfigured(): boolean {
  const cssEnabled = process.env.NEXT_PUBLIC_CSS_ENABLED !== "false";
  return (
    cssEnabled &&
    !!process.env.NEXT_PUBLIC_CSS_SITE_ID &&
    (!!process.env.NEXT_PUBLIC_CSS_API_KEY ||
      process.env.NEXT_PUBLIC_CSS_ENABLE_PRESENCE === "true")
  );
}
```

### Step 2: Replace `components/CSSProviders.tsx`

**Delete** the manual `CSSProvidersInner` component (CSSClient creation, auth gate, CSSPuckProvider wiring). Replace with `<CSSApp>`.

#### Airbus — `components/CSSProviders.tsx`

**Current** (~95 lines): Manual CSSAuthProvider → CSSClient → CSSPuckProvider.

**Replace with:**

```tsx
"use client";

import { CSSApp, useCSSAuth } from "@pantheon/puck-css";
import { getCSSConfig } from "@/lib/css-config";

const config = getCSSConfig();

/**
 * Hook for components that need the current user's identity.
 * Backed by the CSSAuth context.
 */
export function useCurrentUser() {
  const { user } = useCSSAuth();
  return { id: user?.id || "", name: user?.name || "" };
}

export default function CSSProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CSSApp
      config={config}
      loginPageProps={{
        title: "Airbus Content Editor",
        subtitle: "Sign in to start editing",
      }}
    >
      {children}
    </CSSApp>
  );
}
```

#### my-app — `components/CSSProviders.tsx`

**Current** (~83 lines): Same manual pattern.

**Replace with:**

```tsx
"use client";

import { CSSApp } from "@pantheon/puck-css";
import { getCSSConfig } from "../lib/css-config";

const config = getCSSConfig();

export default function CSSProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CSSApp
      config={config}
      loginPageProps={{
        title: "Puck Editor",
        subtitle: "Sign in to start editing",
      }}
    >
      {children}
    </CSSApp>
  );
}
```

### Step 3: Update imports in consuming files

No changes needed in files that import `CSSProviders`, `getCSSConfig`, or `toCSSPath` — the function signatures are preserved. Verify these call sites still work:

#### Airbus call sites (no changes needed):
- `app/page.tsx` — `<CSSProviders>` wrapper
- `app/[...slug]/page.tsx` — `<CSSProviders>` wrapper
- `app/edit/page.tsx` — `<CSSProviders>` wrapper
- `app/edit/[...slug]/page.tsx` — `<CSSProviders>` wrapper
- `app/edit/merge/page.tsx` — `<CSSProviders>` wrapper
- `components/PuckRenderClient.tsx` — `toCSSPath()` import
- `components/PuckEditorClient.tsx` — `toCSSPath()`, `getCSSConfig()` imports
- `components/MergeReviewClient.tsx` — `getCSSConfig()` import

#### my-app call sites (no changes needed):
- `app/(site)/page.tsx` — `CSSProviders`, `isCSSConfigured()`
- `app/(site)/[...puckPath]/page.tsx` — `CSSProviders`, `isCSSConfigured()`
- `components/PuckRenderClient.tsx` — `toCSSPath()` import
- `app/puck/[...puckPath]/EditorWithCSS.tsx` — may import `getCSSConfig()`

### Step 4: Update tests

#### Airbus — `components/__tests__/CSSProviders.test.tsx`

The existing test mocks `@pantheon/puck-css` components individually (CSSAuthProvider, useCSSAuth, CSSLoginPage, CSSPuckProvider). With `<CSSApp>`, the test should mock `CSSApp` instead:

```tsx
vi.mock("@pantheon/puck-css", () => ({
  CSSApp: ({ children, loginPageProps }: any) => (
    <div data-testid="css-app" data-title={loginPageProps?.title}>
      {children}
    </div>
  ),
  useCSSAuth: () => mockAuthState,
}));
```

Tests should verify:
- `CSSProviders` renders `<CSSApp>` with correct `loginPageProps`
- `useCurrentUser()` returns user data from auth context

#### my-app

If tests exist for `CSSProviders.tsx`, apply the same mock pattern.

### Step 5: Verify env var compatibility

Both sites use `NEXT_PUBLIC_` prefixed env vars. `createCSSConfig` with `prefix: "NEXT_PUBLIC_"` will automatically read:

| Env var | Maps to config field |
|---------|---------------------|
| `NEXT_PUBLIC_CSS_BASE_URL` | `baseUrl` |
| `NEXT_PUBLIC_CSS_SITE_ID` | `siteId` |
| `NEXT_PUBLIC_CSS_BRANCH_ID` | `branchId` |
| `NEXT_PUBLIC_CSS_ENABLE_REALTIME` | `enableRealtime` (boolean) |
| `NEXT_PUBLIC_CSS_WS_BASE_URL` | `wsBaseUrl` |
| `NEXT_PUBLIC_CSS_ENABLE_PRESENCE` | `enablePresence` (boolean) |
| `NEXT_PUBLIC_CSS_AUTO_SAVE_DELAY` | `autoSaveDelay` (number) |
| `NEXT_PUBLIC_CSS_MAX_RETRIES` | `maxRetries` (number) |

**Vars that need overrides** (don't follow `CSS_*` naming):

| Env var | Override field |
|---------|---------------|
| `NEXT_PUBLIC_AUTH_MODE` | `authMode` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | `googleClientId` |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | `auth0Domain` |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | `auth0ClientId` |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | `auth0Audience` |

No `.env` file changes are needed — the overrides handle the mismatch.

### Step 6: Build and verify

```bash
# In each site directory:
npm run build    # Verify TypeScript compiles
npm run dev      # Verify app starts and auth works
npm run test     # Verify existing tests pass (if applicable)
```

## What CSSApp handles (that you no longer need to)

1. **Auth gating** — Loading spinner → login page → authenticated content
2. **CSSClient creation** — `useMemo` with `clientBaseUrl || baseUrl` and Bearer token
3. **CSSPuckProvider wrapping** — All config props passed through
4. **FocusHighlightProvider** — Conditionally mounted when `enablePresence` is true
5. **User switch re-mount** — `key={userId-token}` on CSSPuckProvider

## Site-specific notes

### Airbus

- Uses a Next.js proxy at `/css-api` for browser-side requests (avoids CORS). This is passed via `clientBaseUrl: "/css-api"` in the overrides.
- The `useCurrentUser()` hook in `CSSProviders.tsx` must be preserved — it's used by other components. Keep it in the file alongside the `CSSApp` wrapper.
- `wsBaseUrl` has runtime fallback to `window.location.origin` in `CSSProviders.tsx`. With `CSSApp`, this should be set in the override if the env var is empty:
  ```typescript
  wsBaseUrl: process.env.NEXT_PUBLIC_CSS_WS_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : ""),
  ```

### my-app

- Maps `"/" → "homepage"` (not `"home"`). The library's `toCSSPath()` maps to `"home"`, so my-app must keep its own `toCSSPath()` function. Do NOT import `toCSSPath` from `@pantheon/puck-css`.
- Has a CSS enabled/disabled toggle via `NEXT_PUBLIC_CSS_ENABLED`. The `isCSSConfigured()` function must be preserved — it gates whether CSS features are used at all.
- Uses vendored tarballs in `vendor/` directory. Update these with freshly built packages.
- `EditorWithCSS.tsx` (~1500 lines) directly uses `CSSClient`, `useCSSPuck`, and other low-level APIs. This file does NOT use `CSSProviders` and should NOT be migrated to `CSSApp` — it already lives inside the provider tree.

## Files changed per site

### Airbus (~2 files modified)
| File | Action |
|------|--------|
| `lib/css-config.ts` | Rewrite: replace with `createCSSConfig` wrapper |
| `components/CSSProviders.tsx` | Rewrite: replace with `<CSSApp>` wrapper |
| `components/__tests__/CSSProviders.test.tsx` | Update mocks |
| `package.json` | Update `@pantheon/puck-css` and `@pantheon/css-client` versions |

### my-app (~2 files modified)
| File | Action |
|------|--------|
| `lib/css-config.ts` | Rewrite: replace `getCSSConfig` with `createCSSConfig` wrapper, keep custom `toCSSPath` and `isCSSConfigured` |
| `components/CSSProviders.tsx` | Rewrite: replace with `<CSSApp>` wrapper |
| `package.json` | Update vendored package tarballs |

## Validation checklist

- [ ] `npm run build` succeeds (TypeScript compiles)
- [ ] App starts with `npm run dev`
- [ ] Login page appears when not authenticated
- [ ] Login page shows correct title/subtitle
- [ ] Mock auth login works (if `AUTH_MODE=mock`)
- [ ] Google OAuth login works (if `AUTH_MODE=google`)
- [ ] Document loads in editor after auth
- [ ] Auto-save works (edit content, check network tab)
- [ ] Presence avatars appear (if `ENABLE_PRESENCE=true` and multiple users)
- [ ] Branch switching works (if applicable)
- [ ] Merge review page loads (if applicable)
- [ ] Existing tests pass
