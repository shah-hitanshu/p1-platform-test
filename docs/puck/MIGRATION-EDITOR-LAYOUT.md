# Migration Guide: Persistent Editor Layout

This guide covers upgrading to `@pantheon-systems/p1-next-sdk@0.8.x`, in which the P1 editor renders from a persistent **layout** instead of the catch-all **page**. This is what lets the editor survive navigation between documents without a full remount (no more teardown of providers, auth, and the Puck canvas iframe on every page switch).

New projects scaffolded with `create-p1-starter-kit@0.8.x` already have the new structure — this guide is only for **existing apps upgrading the SDK**.

## Breaking: the editor moved from `pages.Page` to `pages.Layout`

`createP1Pages()` now returns a `Layout` that renders the editor, and `Page` is intentionally empty. The editor must be mounted from a static route segment — an `(editor)` route group — so it persists across route-param changes. `EditorClient` is now rendered with **no props** and derives the edited page from the URL.

> **This is a silent breaking change for JavaScript apps.** If you upgrade but keep only the old `app/p1/[[...p1]]/page.tsx` (`export default pages.Page`), `pages.Page` renders `null` and the editor is **blank with no build error**. TypeScript apps get a compile error first — the `EditorClient` prop type changed from `{ path: string }` to no props — but JS apps get no signal. In development the SDK logs a one-time warning pointing here.

## Recommended: run the codemod

From your project root, on a clean git tree:

```bash
npx @pantheon-systems/p1-next-sdk p1-migrate
```

It restructures the routes for you and leaves sibling routes (`/p1/merge`, `/p1/api`, `/p1/auth`) untouched. Preview first with `--dry-run`; the codemod refuses to run on a dirty tree unless you pass `--force`, is safe to re-run (idempotent), and **bails with a pointer back to this guide** if your files have diverged from the starter shape. If it bails, follow the manual steps below.

```bash
npx @pantheon-systems/p1-next-sdk p1-migrate --dry-run   # preview
npx @pantheon-systems/p1-next-sdk p1-migrate             # apply
```

Review the diff and commit it as its own change.

## Manual steps

If you customized the editor route and the codemod bailed, apply the same transform by hand. The move adds one real on-disk directory (`(editor)/`) that the URL never sees, so **every relative import in a moved file gains one `../`**.

### 1. Move the catch-all into an `(editor)` route group

```
app/p1/[[...p1]]/page.tsx          ->  app/p1/(editor)/[[...p1]]/p1-pages.tsx   (+ new page.tsx)
app/p1/[[...p1]]/editor-client.tsx ->  app/p1/(editor)/[[...p1]]/editor-client.tsx
                                       app/p1/(editor)/layout.tsx               (new)
```

Sibling routes stay **outside** the group so the editor never wraps them:

```
app/p1/merge/…    app/p1/api/…    app/p1/auth/…    (unchanged)
```

### 2. Split `page.tsx` into a shared factory module + a thin page

Extract the `createP1Pages(...)` call into `p1-pages.tsx` and **export** it, so both the layout and the page can import it. Deepen the `config` import by one level, and drop the `puck.css` side-effect import (it moves to the layout).

`app/p1/(editor)/[[...p1]]/p1-pages.tsx`:
```diff
-import "@puckeditor/core/puck.css";
 import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";
-import config from "../../../puck.config";
+import config from "../../../../puck.config";
 import { EditorClientWrapper } from "./editor-client";

-const pages = createP1Pages({
+export const pages = createP1Pages({
   config,
   // …your existing options…
   EditorClient: EditorClientWrapper,
 });
-
-export default pages.Page;
-export const generateMetadata = pages.generateMetadata;
-export const dynamic = "force-dynamic";
```

`app/p1/(editor)/[[...p1]]/page.tsx` (new, thin):
```tsx
import { pages } from "./p1-pages";

export default pages.Page;
export const generateMetadata = pages.generateMetadata;
export const dynamic = "force-dynamic";
```

### 3. Add the `(editor)` layout

`app/p1/(editor)/layout.tsx` (new):
```tsx
import "@puckeditor/core/puck.css";
import { pages } from "./[[...p1]]/p1-pages";

export default pages.Layout;
```

The layout must live at the `(editor)` group, **not** at `app/p1/layout.tsx` — a layout at `/p1` would wrap every sibling route (`/p1/merge`, …) and render the editor on top of them.

### 4. Derive the edited path from the URL in `editor-client.tsx`

`EditorClient` is rendered by the layout with no props, so it reads the path from the URL instead of a prop. Add `usePathname` and `editorPagePathFromUrlPath`, and drop the `{ path }` parameter:

```diff
-import { useRouter } from "next/navigation";
+import { usePathname, useRouter } from "next/navigation";
-import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";
+import { P1NextRouterProvider, editorPagePathFromUrlPath } from "@pantheon-systems/p1-next-sdk";
```

```diff
-export function EditorClientWrapper({ path }: { path: string }) {
+export function EditorClientWrapper() {
+  const pathname = usePathname();
+  const path = editorPagePathFromUrlPath(pathname);
   // …rest of the component unchanged…
```

Then deepen the remaining relative imports in this file by one level (`../../../…` → `../../../../…`).

### 5. Remove any `NON_EDITOR_ROUTES` opt-out list

Earlier versions kept the editor off sibling routes with a hand-maintained `NON_EDITOR_ROUTES` array. The `(editor)` route group makes siblings editor-free by construction, so delete that list.

## Minimum structure after migration

```
app/p1/
  (editor)/
    layout.tsx              # export default pages.Layout
    [[...p1]]/
      p1-pages.tsx          # export const pages = createP1Pages({ … })
      page.tsx              # re-exports pages.Page / generateMetadata / dynamic
      editor-client.tsx     # EditorClientWrapper() — derives path from the URL
  merge/                    # siblings stay outside (editor)
  api/
  auth/
```

The editor is mounted at `/p1`; the client derives the edited page via `editorPagePathFromUrlPath`, whose base path defaults to `/p1`. If you mount the editor somewhere else, pass the matching base path to `editorPagePathFromUrlPath`.
