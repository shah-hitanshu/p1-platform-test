# Content Delivery Layer — Implementation Plan

## Overview

This plan adds a content delivery layer to the Collaborative State System, enabling
server-side rendering (SSR) and incremental static regeneration (ISR) for consuming
apps. It introduces dedicated content endpoints, configurable caching, granular
scope enforcement for service tokens, admin UI updates, a server-side content client
library, and a high-level module API that eliminates per-app boilerplate.

## Phase Sequencing

```
Phase 1 (Site Settings) ─────────────┬──> Phase 2 (Content Endpoints) ──> Phase 3 (Scopes)
                                      │                                         │
                                      └──> Phase 5 (Settings UI)                v
                                                                          Phase 4 (Token UI)

Phase 2 ──> Phase 6 (CSSContentClient) ──> Phase 7 (Module API)
```

- Phases 4 and 5 can run in parallel (independent frontend sections).
- Phase 5 can start as soon as Phase 1 is complete.
- Phase 6 depends only on Phase 2 (content endpoints must exist to consume them).
- Phase 7 depends on Phase 6.

---

## Phase 1: Site Settings Infrastructure

### Dependencies
None.

### Files to create
| File | Purpose |
|------|---------|
| `workers/src/db/migrations/021_site_settings.sql` | Add `settings JSONB` column to `app.sites` |
| `workers/src/services/site-settings-service.ts` | Service functions for reading/writing settings |
| `workers/src/routes/site-settings-api.ts` | Route handlers for `GET/PATCH /api/sites/{siteId}/settings` |
| `workers/tests/services/site-settings-service.spec.ts` | Unit tests for settings service |
| `workers/tests/routes/site-settings-api.spec.ts` | Route handler tests |

### Files to modify
| File | Change |
|------|--------|
| `workers/src/index.ts` | Route parsing for `/api/sites/{siteId}/settings`; add `DEFAULT_CACHE_TTL_MAIN` and `DEFAULT_CACHE_TTL_BRANCH` to `Env` interface |

### Implementation

**Migration `021_site_settings.sql`:**
```sql
ALTER TABLE app.sites
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
```

**`SiteSettings` interface:**
```typescript
interface SiteSettings {
  cacheTtlMain?: number;    // seconds, default 60
  cacheTtlBranch?: number;  // seconds, default 5
}
```

**Service functions:**
- `getSiteSettings(siteId)` — Returns the `settings` column merged with defaults.
- `updateSiteSettings(siteId, settings)` — JSONB merge update using `||` operator.
  Validates `cacheTtlMain` and `cacheTtlBranch` are positive integers when provided.
  Passing `null` for a field removes the override (reverts to default).
- `getEffectiveCacheTtl(siteSettings, isMainBranch, envDefaults)` — Pure function
  resolving per-site override vs global default.

**Route handlers:**
- `GET /api/sites/{siteId}/settings` — Requires `canView` permission. Returns
  `{ settings }` with effective values (overrides merged with defaults).
- `PATCH /api/sites/{siteId}/settings` — Requires `canManageGrants` (admin).
  Accepts partial `SiteSettings` body. Validates fields, merges, returns updated
  `{ settings }`.

**Environment variables:**
```
DEFAULT_CACHE_TTL_MAIN=60
DEFAULT_CACHE_TTL_BRANCH=5
```

### Tests
- `getSiteSettings` returns defaults when column is `{}`.
- `updateSiteSettings` constructs correct SQL with JSONB merge.
- `getEffectiveCacheTtl` with various combos: site override present/absent, main/non-main.
- Route auth: service principals blocked, non-admin users get 403.
- Validation: negative TTL rejected, non-integer rejected.

---

## Phase 2: Content Delivery Endpoints

### Dependencies
Phase 1 (site settings for cache TTL resolution).

### Files to create
| File | Purpose |
|------|---------|
| `workers/src/routes/content-api.ts` | Route handlers for content endpoints |
| `workers/tests/routes/content-api.spec.ts` | Tests |

### Files to modify
| File | Change |
|------|--------|
| `workers/src/index.ts` | Route parsing for `/api/sites/{siteId}/content/{documentPath}` and `/api/sites/{siteId}/content-pages`; wire to handler; use cached Hyperdrive |

### Endpoint 1: `GET /api/sites/{siteId}/content/{documentPath}`

Fetches the latest saved version of a document. Designed for SSR/ISR consumption.

**Query parameters:**
- `branch` (optional) — Branch ID. Defaults to main branch when omitted.

**Response (200):**
```json
{
  "documentId": "abc-123",
  "path": "home",
  "data": { "root": { ... }, "content": [ ... ] },
  "branchId": "branch-uuid",
  "branchName": "main",
  "isMainBranch": true,
  "versionNumber": 14,
  "versionCreatedAt": "2026-03-07T18:00:00Z",
  "etag": "\"v-version-uuid\""
}
```

**Implementation steps:**
1. Read `?branch` query param. If absent, resolve via `getMainBranch(siteId)`.
2. If branch param provided, call `getBranch(branchId)` and validate it belongs to site.
3. `getDocumentByPath(siteId, documentPath)` -> 404 if not found.
4. `getLatestDocumentVersion(documentId, branchId)` -> 404 if no version on branch.
5. Tombstone check: if `snapshot._deleted === true`, return 404.
6. Compute ETag from version ID: `"v-{versionId}"`.
7. Check `If-None-Match` header -> 304 with no body if match.
8. Load site settings, compute cache TTL via `getEffectiveCacheTtl`.
9. Return response with headers:
   - `Cache-Control: public, s-maxage={ttl}, stale-while-revalidate={ttl * 5}`
   - `ETag: "v-{versionId}"`
   - `Vary: Accept-Encoding`

### Endpoint 2: `GET /api/sites/{siteId}/content-pages`

Lists all document paths on a branch. Designed for `generateStaticParams()` /
`getStaticPaths()`.

**Query parameters:**
- `branch` (optional) — Branch ID. Defaults to main branch when omitted.

**Response (200):**
```json
{
  "pages": [
    { "path": "home", "documentId": "abc-123", "lastModifiedAt": "2026-03-07T18:00:00Z" },
    { "path": "about", "documentId": "def-456", "lastModifiedAt": "2026-03-06T12:00:00Z" }
  ],
  "branchId": "branch-uuid",
  "branchName": "main",
  "isMainBranch": true
}
```

**Implementation steps:**
1. Resolve branch (same logic as content endpoint).
2. `listDocumentsOnBranch(branchId)` — already filters tombstoned documents.
3. For each document, get latest version `created_at` as `lastModifiedAt`.
4. Cache TTL: double the page TTL, capped at 300s.
5. Return response with `Cache-Control` headers.

### Tests
- Default branch resolution (no `?branch`).
- Explicit branch parameter.
- 404 when document not found.
- 404 when document is tombstoned.
- 304 when `If-None-Match` matches ETag.
- `Cache-Control` header uses site settings when configured.
- `Cache-Control` falls back to global defaults.
- `content-pages` returns correct paths, filters tombstones.

---

## Phase 3: Scope Enforcement

### Dependencies
Phase 2 (content endpoints must exist).

### Files to modify
| File | Change |
|------|--------|
| `workers/src/auth/service-principal.ts` | Replace `SCOPE_METHODS` with `SCOPE_RULES`; add route-aware and branch-aware enforcement |
| `workers/src/index.ts` | Pass route handler name and resolved branch context to scope enforcement |

### Files to create
| File | Purpose |
|------|---------|
| `workers/tests/auth/service-principal-scopes.spec.ts` | Scope enforcement tests |

### Scope definitions

| Scope | Content endpoints | Content-pages | Document/Version CRUD |
|-------|------------------|---------------|----------------------|
| `read:published` | GET, main branch only | GET, main branch only | Blocked (403) |
| `read:all` | GET, any branch | GET, any branch | Blocked (403) |
| `read:draft` | GET, any branch | GET, any branch | GET only |

### Implementation

Replace `SCOPE_METHODS` with a richer rule structure:

```typescript
interface ScopeRule {
  methods: string[];
  allowedHandlers: string[] | '*';
  mainBranchOnly?: boolean;
}

const SCOPE_RULES: Record<string, ScopeRule> = {
  'read:published': {
    methods: ['GET'],
    allowedHandlers: ['content'],
    mainBranchOnly: true,
  },
  'read:all': {
    methods: ['GET'],
    allowedHandlers: ['content'],
    mainBranchOnly: false,
  },
  'read:draft': {
    methods: ['GET'],
    allowedHandlers: ['content', 'documents', 'branches'],
    mainBranchOnly: false,
  },
};
```

Update `isServicePrincipalAllowed` signature:
```typescript
function isServicePrincipalAllowed(
  principal: AuthenticatedPrincipal,
  requestSiteId: string,
  method: string,
  routeHandler: string,
  branchIsMain?: boolean,
): ServicePrincipalCheck
```

Enforcement logic:
- `read:published` with `?branch=` pointing to non-main -> 403.
- `read:all` allows any branch on content endpoints but blocks document CRUD.
- `read:draft` allows GET on document/branch CRUD endpoints.
- Single call site in `index.ts`, so signature change is safe.
- Default scope for new tokens remains `read:published`.

### Tests
- Each scope x each handler x main/non-main branch matrix.
- `read:published` + content + main = allowed.
- `read:published` + content + non-main = denied.
- `read:published` + documents = denied.
- `read:all` + content + non-main = allowed.
- `read:all` + documents = denied.
- `read:draft` + documents + GET = allowed.
- `read:draft` + documents + POST = denied.
- Non-service principals pass through unrestricted.

---

## Phase 4: Admin Frontend — Token Scopes

### Dependencies
Phase 3 (scope definitions must exist).

### Files to create
| File | Purpose |
|------|---------|
| `frontend/src/components/ScopeSelector.tsx` | Scope checkbox component |
| `frontend/tests/components/ScopeSelector.spec.tsx` | Component tests |

### Files to modify
| File | Change |
|------|--------|
| `frontend/src/pages/SiteDetailPage.tsx` | Wire scope selector into generate form; display scope badges on tokens |

### Implementation

**`ScopeSelector` component:**
```typescript
interface ScopeSelectorProps {
  selectedScopes: string[];
  onChange: (scopes: string[]) => void;
}
```

Three checkboxes:
- "Published content (main branch only)" -> `read:published`
- "All branch content" -> `read:all`
- "Draft data (editor API)" -> `read:draft`

Selection logic:
- `read:all` supersedes `read:published` (auto-uncheck published if all is selected).
- `read:draft` includes all read access (informational note shown).
- At least one scope must be selected.

**SiteDetailPage changes:**
- Add `selectedScopes` state, defaulting to `['read:published']`.
- Wire `ScopeSelector` into the token creation form.
- Pass `scopes` to `generateSiteToken` API call.
- Display scope badges on each token row with color coding:
  `read:published` = gray, `read:all` = blue, `read:draft` = green.

### Tests
- Default selection is `read:published`.
- Selecting `read:all` unchecks `read:published`.
- At least one scope always selected (can't uncheck all).
- Callback returns expected scope array.
- Scope badges render correctly on token rows.

---

## Phase 5: Admin Frontend — Site Cache Settings

### Dependencies
Phase 1 (settings API must exist). Can run in parallel with Phases 2-4.

### Files to create
| File | Purpose |
|------|---------|
| `frontend/src/components/CacheSettings.tsx` | Cache TTL form component |
| `frontend/src/api/site-settings.ts` | Frontend API client for settings |
| `frontend/tests/components/CacheSettings.spec.tsx` | Component tests |

### Files to modify
| File | Change |
|------|--------|
| `frontend/src/pages/SiteDetailPage.tsx` | Add "Settings" section; fetch settings on load |
| `frontend/src/pages/SiteDetailPage.css` | Settings section styles |

### Implementation

**`site-settings.ts` API client:**
```typescript
export async function getSiteSettings(siteId: string): Promise<SiteSettings>
export async function updateSiteSettings(siteId: string, settings: Partial<SiteSettings>): Promise<SiteSettings>
```

**`CacheSettings` component:**
- Two number inputs: "Main branch cache TTL (seconds)" and "Preview branch cache TTL (seconds)".
- Placeholders show global defaults (e.g., "60 (default)").
- "Reset to defaults" button sends `PATCH` with `{ cacheTtlMain: null, cacheTtlBranch: null }`.
- Save button calls `updateSiteSettings`.
- Brief explanation: "Controls how long CDN and ISR caches serve content before
  checking for updates."

**SiteDetailPage changes:**
- New "Settings" section after API Tokens section.
- Fetch settings on page load alongside other data.
- Wire `CacheSettings` with current values and save handler.

### Tests
- Render with existing settings (shows values in inputs).
- Render with empty settings (shows default placeholders).
- "Reset to defaults" triggers update with null values.
- Save calls API with entered values.
- Loading state while fetching.

---

## Phase 6: CSSContentClient

### Dependencies
Phase 2 (content endpoints must exist).

### Package
`@pantheon/css-client` in the **puck-css-integration** repo — added to the existing client package alongside `CSSClient`.

### Files created (in puck-css-integration repo)
| File | Purpose |
|------|---------|
| `packages/css-client/src/content.ts` | `CSSContentClient` class |
| `packages/css-client/tests/content.spec.ts` | Unit tests with mocked fetch |

### Files modified (in puck-css-integration repo)
| File | Change |
|------|--------|
| `packages/css-client/src/index.ts` | Export `CSSContentClient` and types |
| `packages/css-client/package.json` | Added `./content` subpath export |

### API

```typescript
export interface CSSContentClientConfig {
  /** CSS backend URL */
  baseUrl: string;
  /** Site API token (sat_...) — server-side only */
  apiToken: string;
  /** Site ID */
  siteId: string;
  /** Branch ID. Omit for main (production). Set for multidev/preview. */
  branchId?: string;
}

export interface PageContent {
  documentId: string;
  path: string;
  data: Record<string, unknown>;
  branchId: string;
  branchName: string;
  isMainBranch: boolean;
  versionNumber: number;
  versionCreatedAt: string;
  etag: string;
}

export interface PageListEntry {
  path: string;
  documentId: string;
  lastModifiedAt: string;
}

export interface PageListResult {
  pages: PageListEntry[];
  branchId: string;
  branchName: string;
  isMainBranch: boolean;
}

export class CSSContentClient {
  constructor(config: CSSContentClientConfig);

  /**
   * Fetch page content by path.
   * Returns null if document not found or tombstoned.
   */
  getPage(documentPath: string): Promise<PageContent | null>;

  /**
   * List all page paths on the configured branch.
   * For generateStaticParams() / getStaticPaths().
   */
  getPagePaths(): Promise<PageListResult>;
}
```

### Implementation details
- Uses `X-API-Key` header for `sat_` tokens (matches existing auth flow).
- Zero browser dependencies — global `fetch` only (Node 18+, Deno, Bun, Workers).
- `branchId` appended as `?branch={id}` query param when set.
- 404 -> `null`, non-404 errors -> throw `CSSApiError`.

### Tests
- Mock global `fetch`.
- `getPage` with 200 — verify returned structure.
- `getPage` with 404 — returns `null`.
- `getPage` with branch configured — verify query param.
- `getPagePaths` response parsing.
- Auth header set correctly (`X-API-Key: sat_...`).
- Error handling for 500/403 responses.

---

## Phase 7: High-Level Module API

### Dependencies
Phase 6.

### Package
`@pantheon/puck-css`

### Files to create
| File | Purpose |
|------|---------|
| `packages/puck-css/src/config.ts` | `createCSSConfig()` factory and `CSSConfig` type |
| `packages/puck-css/src/CSSApp.tsx` | Combined auth + client + provider wrapper |
| `packages/puck-css/src/utils/path.ts` | `toCSSPath()` utility |
| `packages/puck-css/src/config.test.ts` | Config tests |
| `packages/puck-css/src/CSSApp.test.tsx` | Component tests |
| `packages/puck-css/src/utils/path.test.ts` | Path utility tests |

### Files to modify
| File | Change |
|------|--------|
| `packages/puck-css/src/index.ts` | Export new APIs |
| `apps/demo/src/App.tsx` | Full rewrite to use new API |

### `createCSSConfig`

```typescript
export interface CSSConfig {
  /** CSS backend URL */
  baseUrl: string;
  /** Browser-facing URL when proxied (defaults to baseUrl) */
  clientBaseUrl?: string;
  /** Site ID */
  siteId: string;
  /** Branch ID (defaults to main) */
  branchId?: string;
  /** Auth mode for editor */
  authMode: AuthMode;
  /** Google OAuth client ID */
  googleClientId?: string;
  /** Auth0 config */
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0Audience?: string;
  /** Enable WebSocket realtime sync */
  enableRealtime?: boolean;
  /** WebSocket URL */
  wsBaseUrl?: string;
  /** Enable presence tracking and focus highlighting */
  enablePresence?: boolean;
  /** Auto-save delay in ms (default: 3000) */
  autoSaveDelay?: number;
  /** Max retries for failed saves (default: 3) */
  maxRetries?: number;
}

/**
 * Create config from an environment source (process.env, import.meta.env, etc.).
 * The library never reads env vars directly — the caller provides the source.
 */
export function createCSSConfig(
  envSource: Record<string, string | undefined>,
  options?: {
    prefix?: string;            // e.g., "NEXT_PUBLIC_" or "VITE_"
    overrides?: Partial<CSSConfig>;
  }
): CSSConfig;
```

Usage:
```typescript
// Next.js
const config = createCSSConfig(process.env, { prefix: 'NEXT_PUBLIC_' });
// Vite
const config = createCSSConfig(import.meta.env, { prefix: 'VITE_' });
// Manual
const config: CSSConfig = { baseUrl: '...', siteId: '...', authMode: 'google' };
```

### `<CSSApp>`

```typescript
export interface CSSAppProps {
  /** CSS configuration */
  config: CSSConfig;
  /** Children rendered when authenticated and ready */
  children: React.ReactNode;
  /** Custom loading component (default: centered "Authenticating...") */
  loadingFallback?: React.ReactNode;
  /** Custom login component (default: <CSSLoginPage />) */
  loginFallback?: React.ReactElement;
  /** Props forwarded to default CSSLoginPage */
  loginPageProps?: { title?: string; subtitle?: string };
}
```

**What it does internally:**
1. Renders `<CSSAuthProvider>` with auth props from config.
2. Auth gate: shows `loadingFallback` while loading, `loginFallback` when not authenticated.
3. When authenticated, creates `CSSClient` via `useMemo` using token from auth context.
4. Wraps children in `<CSSPuckProvider>` with all relevant props from config and auth state.
5. Uses `key={userId-token}` on provider to force clean re-mount on user switch.
6. **Conditionally mounts providers based on config flags:**
   - `enableRealtime`: Enables WebSocket sync in `CSSPuckProvider` (passed as prop).
   - `enablePresence`: Mounts `FocusHighlightProvider` and enables presence tracking
     in `CSSPuckProvider`. When false, no WebSocket connections for presence, no
     focus highlighting setup, no Durable Object activity for unused features.
   - Both default to `false` when not set — zero overhead for non-collaborative use cases.

**Provider tree when fully enabled:**
```
<CSSAuthProvider>
  <AuthGate>
    <CSSPuckProvider enableRealtime enablePresence>
      <FocusHighlightProvider>
        {children}
      </FocusHighlightProvider>
    </CSSPuckProvider>
  </AuthGate>
</CSSAuthProvider>
```

**Provider tree when presence disabled:**
```
<CSSAuthProvider>
  <AuthGate>
    <CSSPuckProvider>
      {children}
    </CSSPuckProvider>
  </AuthGate>
</CSSAuthProvider>
```

### `toCSSPath`

```typescript
/**
 * Convert a route path to a CSS document path.
 * "/" -> "home"
 * "/about" -> "about"
 * "/en/products" -> "en/products"
 */
export function toCSSPath(routePath: string): string;
```

### Demo app rewrite

Full rewrite of `apps/demo/src/App.tsx` to validate the new API:

**Before** (~300 lines): Manual `CSSAuthProvider` + `useCSSAuth` + auth gate +
`CSSClient` creation + `CSSPuckProvider` + `UserSwitcher` + `ConfigWarning`.

**After** (~80 lines):
```tsx
import { CSSApp, createCSSConfig, useCSSEditor } from '@pantheon/puck-css';
import { Puck } from '@puckeditor/core';

const config = createCSSConfig(import.meta.env, { prefix: 'VITE_' });

function Editor() {
  const { loading, error, puckProps } = useCSSEditor({
    documentPath: 'home',
    puckConfig,
  });
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  return <Puck {...puckProps} />;
}

export function App() {
  return (
    <CSSApp
      config={config}
      loginPageProps={{ title: 'CSS Demo', subtitle: 'Sign in to edit' }}
    >
      <Editor />
    </CSSApp>
  );
}
```

### Exports added to `@pantheon/puck-css`

```typescript
// High-level API (new)
export { CSSApp } from './CSSApp';
export type { CSSAppProps } from './CSSApp';
export { createCSSConfig } from './config';
export type { CSSConfig } from './config';
export { toCSSPath } from './utils/path';

// All existing exports remain unchanged
```

### Tests
- `createCSSConfig`: valid config returns populated object; missing baseUrl throws;
  prefix extraction works; overrides win over env values.
- `toCSSPath`: root path, leading slashes, trailing slashes, multi-segment paths.
- `<CSSApp>`: loading state renders fallback; unauthenticated renders login page;
  authenticated renders children within providers; presence providers mounted only
  when `enablePresence` is true.

---

## Framework Integration Examples

### Next.js App Router — Production (SSR/ISR)

```typescript
// lib/css-content.ts (server-only)
import { CSSContentClient } from '@pantheon/css-client';

export const cssContent = new CSSContentClient({
  baseUrl: process.env.CSS_BASE_URL!,
  apiToken: process.env.CSS_API_TOKEN!,
  siteId: process.env.CSS_SITE_ID!,
  branchId: process.env.CSS_BRANCH_ID || undefined, // set for multidevs
});
```

```typescript
// app/(site)/[...path]/page.tsx (Server Component, no "use client")
import { Render } from '@puckeditor/core';
import puckConfig from '@/puck.config';
import { cssContent } from '@/lib/css-content';
import { toCSSPath } from '@pantheon/puck-css';
import { notFound } from 'next/navigation';

export const revalidate = 60;

export async function generateStaticParams() {
  const { pages } = await cssContent.getPagePaths();
  return pages.map(p => ({
    path: p.path === 'home' ? [] : p.path.split('/'),
  }));
}

export default async function Page({ params }) {
  const { path = [] } = await params;
  const page = await cssContent.getPage(toCSSPath('/' + path.join('/')));
  if (!page) return notFound();
  return <Render config={puckConfig} data={page.data} />;
}
```

```typescript
// app/edit/[...path]/page.tsx ("use client" — editor)
import { CSSApp, createCSSConfig, useCSSEditor, toCSSPath } from '@pantheon/puck-css';
import { Puck } from '@puckeditor/core';
import puckConfig from '@/puck.config';

const config = createCSSConfig(process.env, { prefix: 'NEXT_PUBLIC_' });

function Editor({ path }: { path: string }) {
  const { loading, error, puckProps } = useCSSEditor({
    documentPath: toCSSPath(path),
    puckConfig,
  });
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  return <Puck {...puckProps} />;
}

export default function EditPage({ params }) {
  const path = '/' + (params.path || []).join('/');
  return (
    <CSSApp config={config}>
      <Editor path={path} />
    </CSSApp>
  );
}
```

### Environment Variable Separation

```env
# Server-only (never in browser bundle)
CSS_BASE_URL=https://collaborative-state-worker-sbx1.chris-801.workers.dev
CSS_API_TOKEN=sat_xxxxxxxxxxxxx
CSS_SITE_ID=35b800c4-6010-4908-a724-f1512e2a2144
CSS_BRANCH_ID=                                      # empty for production, set for multidevs

# Client-side (embedded in JS bundle, used by editor)
NEXT_PUBLIC_CSS_BASE_URL=https://collaborative-state-worker-sbx1.chris-801.workers.dev
NEXT_PUBLIC_CSS_SITE_ID=35b800c4-6010-4908-a724-f1512e2a2144
NEXT_PUBLIC_AUTH_MODE=google
NEXT_PUBLIC_GOOGLE_CLIENT_ID=698568233370-...
NEXT_PUBLIC_CSS_ENABLE_REALTIME=true
NEXT_PUBLIC_CSS_ENABLE_PRESENCE=true
```

### Remix

```typescript
// app/routes/$path.tsx
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { Render } from '@puckeditor/core';
import { cssContent } from '~/lib/css-content';
import { toCSSPath } from '@pantheon/puck-css';
import puckConfig from '~/puck.config';

export async function loader({ params }) {
  const page = await cssContent.getPage(toCSSPath('/' + params.path));
  if (!page) throw new Response('Not Found', { status: 404 });
  return json(page, {
    headers: { 'Cache-Control': 'public, s-maxage=60' },
  });
}

export default function Page() {
  const page = useLoaderData();
  return <Render config={puckConfig} data={page.data} />;
}
```

### Astro

```astro
---
// src/pages/[...path].astro
import { Render } from '@puckeditor/core';
import { cssContent } from '../lib/css-content';
import { toCSSPath } from '@pantheon/puck-css';
import puckConfig from '../puck.config';

const page = await cssContent.getPage(toCSSPath('/' + Astro.params.path));
if (!page) return Astro.redirect('/404');
---
<Render config={puckConfig} data={page.data} />
```

---

## Decisions Made

1. **URL structure:** `/api/sites/{siteId}/content/{path}` (not `/pages/`).
2. **Scope naming:** `read:published` (main only), `read:all` (any branch), `read:draft` (editor API).
3. **No `hasChanged` method:** `CSSContentClient` ships two methods: `getPage` and `getPagePaths`. Frameworks manage their own cache/revalidation via ISR timers and `Cache-Control` headers. ETag support can be added later without breaking changes.
4. **Presence is config-driven in `<CSSApp>`:** `enablePresence` and `enableRealtime` flags control whether WebSocket/presence providers are mounted. When false (default), zero overhead — no WebSocket connections, no Durable Object activity. No need for opt-in wrapper components.
5. **`CSSContentClient` lives in `@pantheon/css-client`:** It's a low-level HTTP client with zero React/browser dependencies. Pairs naturally with the existing `CSSClient`.
6. **Demo app gets a full rewrite** to validate the new `createCSSConfig` / `<CSSApp>` API.
7. **Site settings use JSONB column** on `app.sites` for extensibility.
