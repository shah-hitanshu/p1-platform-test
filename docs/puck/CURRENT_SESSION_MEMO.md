# ACTIVE (2026-06-26): Create Page Modal rev2 — integrate onto content-type templates

**Branch:** `create-page-modal-rev2` (based on `origin/main`, which now includes Kevin Stubbs'
PCC-3225 content-type template system). `feat/create-page-modal` is the untouched reference.

**Why this branch exists:** the modal on `feat/create-page-modal` faked page types
(`CONTENT_TYPES` mock). PCC-3225 landed a real template system (`useTemplateList`,
`scaffoldFromTemplate`, css-client `templates` endpoint, `template_id/version` bindings, role
perms). We branched fresh from main (not a rebase — too many repeated conflicts across the shared
create chain) and re-apply the modal work once against main. NOT ready to merge to main (would
impact people); just basing off it.

**Plan = components, TDD each (see CLAUDE.md):**
- #1 ✅ Mount `CreatePageModal` behind a TEMPORARY `＋ New page (modal)` trigger in `P1EditorHeader`,
  coexisting with Kevin's inline PageNavigator template-step + `/structure` flow (both kept during
  dev; removed once the modal is the sole entry point). Commits: test `02e0b19`, impl `ddd193b`.
- #2 ✅ Thread page **title** through the create chain as `(path, template?, title?)`
  (`P1EditorHeader → P1Plugin → useP1Plugin → P1PuckProvider → useDocuments`); title lands in
  `root.props.title`, composing with template scaffolding. Commits: test `3e613d1`, impl `9c60043`.
- #3 ✅ Feed **real templates** into the modal; deleted the `CONTENT_TYPES` mock; zero templates →
  "No Page type template configured." Commits: test `34425c3`, impl `fe0b5d3`.

**DONE 2026-06-27/28 (templates editable end-to-end — all verified + committed):**
- #3b ✅ Create template from the modal → `P1PuckProvider.createTemplate` → opens new template's
  editor at `_registry/templates/<name>`. (`2807504`)
- ✅ Template-mode right sidebar `TemplateDetailsPanel` (Name read-only / Label / Description / URL),
  saves via `updateTemplate`; root header relabeled "Page"→"Template" (`config.root.label` in
  useP1Editor). PDS button + `--puck-space-px` gutter. (`19bb204`)
- ✅ Pages | Templates tabs in `PageNavigator` — browse + click-to-edit templates. (`f6ba15a`)
- ✅ Fix: `/p1/structure` zero rows — defaulted `p1BranchId` to 'main' at all starter init sites
  (unset `NEXT_PUBLIC_CSS_BRANCH_ID` → "Branch ID required" → listDocuments returned []). (`8e00603`)

**TOMORROW'S PLAN (user, 2026-06-28):** finish **dynamic routing** + **data source management**,
including a **Google Sheet → JSON importer**. (Context for data sources lives in the loader/remote-
datasource code: `data/remote-datasources/loader.ts`, `user-remote-datasource-store.ts`, the editor
"Data sources" panel `p1/editor/remote-datasources/`, built-in fetchers in
`apps/p1-starter/lib/remote-datasource-fetchers.ts` + `lib/swapi.ts`. The modal's collection builder
already has a "Add a data source" pane with a `google-sheet` type option (currently mocked).)

**ALSO STILL OPEN:**
- #4 = create a **page FROM** a selected template in the modal (scaffold + bind; enable Create).
  Chain already accepts `(path, template?, title?)`; header `handleModalCreateDocument` passes
  `template=undefined`.
- Template-mode polish: tiny unlabeled lock (pin), raw `_registry/...` in page-selector, no "TEMPLATE"
  banner, page-only actions not hidden, redundant `TemplateManagerOverlay` coexists.
- Cleanup: remove temp `＋ New page (modal)` trigger + Kevin's inline PageNavigator template-step once
  the modal is the sole entry point.

**ROLE RESOLUTION — investigated then DEFERRED (2026-06-27):** the overlay is admin-gated, so we
checked where the real role comes from. Role is NOT in the user JWT (only identity claims) nor in
`AuthUser`; `.env.local` is site/service creds only; `/api/auth/me` has no role ⇒ role is a
**backend per-site membership lookup** (endpoint unknown, not in css-client). Real roles are
**Admin/Member** but Kevin's `mapCssRoleToContentRole` expects `ADMIN/EDITOR/VIEWER/NO_ACCESS` and
`useResolveContentRole` isn't wired in the starter. Intended fix: app resolves role via
`useResolveContentRole` → pass `userRole` to provider. DEFERRED (own task, needs backend endpoint;
belongs to PCC-3225). Use the dev `RoleSwitcher` (bottom-right of editor) to simulate `admin` for
testing meanwhile. All temp role-debug code was reverted. Details in PROGRESS.md.

**Build/run:** `cd apps/p1-starter && pnpm dev` (serves BUILT puck-css dist on :3001 — 3000 was
taken). After puck-css edits: build css-client then puck-css, then restart dev. Tests:
`CI=true pnpm --filter @pantheon-systems/puck-css exec vitest run <file>`. Lint baseline = 0
errors / 263 pre-existing warnings (don't fix unrelated ones). Detailed log in PROGRESS.md.

---

# PARKED — older threads below (pre-rev2, may be stale on this branch)

# Session Memo: Plugin Rail Toggle Implementation

## Current Situation (2026-06-18)

We're implementing a toggle button in the Puck editor's subheader to show/hide the plugin rail (left navigation menu with Blocks/Outline/History/Data sources).

## What Works ✓

1. **Left Panel Toggle** (tableRows icon) - Controls `_BlocksPlugin_1ey1i_1`
   - State: `leftSideBarVisible` (boolean)
   - Working correctly ✓

2. **Right Panel Toggle** (penField icon) - Controls `_Sidebar_o396p_1 _Sidebar--right_o396p_25`
   - State: `rightSideBarVisible` (boolean)  
   - Working correctly ✓

## What Doesn't Work ✗

3. **Plugin Rail Toggle** (angleRight/angleLeft icons) - Should control `_PuckLayout-nav_1dd16_192`
   - Current state: `itemSelectorVisible` (boolean)
   - **Problem**: Clicking the button does nothing - no element on the page changes
   - The nav menu markup:
     ```html
     <div class="_PuckLayout-nav_1dd16_192">
       <nav class="_Nav_1tvxq_1">
         <ul class="_Nav-list_1tvxq_5">
           <li>Blocks</li>
           <li>Outline</li>
           <li>History</li>
           <li>Data sources</li>
         </ul>
       </nav>
     </div>
     ```

## Current Implementation

**File: `packages/puck-css/src/editor/plugin/P1Plugin.tsx`**

```typescript
interface PuckUiState {
  leftSideBarVisible: boolean;
  rightSideBarVisible: boolean;
  itemSelectorVisible?: boolean;
}

// In P1SubheaderBridgeInner:
const leftPanelVisible = puckUi?.leftSideBarVisible ?? true;
const pluginRailVisible = puckUi?.itemSelectorVisible ?? true;
const rightPanelVisible = puckUi?.rightSideBarVisible ?? true;

const handleToggleLeftPanel = () => {
  puckDispatch?.({ type: 'setUi', ui: { leftSideBarVisible: !leftPanelVisible } });
};

const handleTogglePluginRail = () => {
  puckDispatch?.({ type: 'setUi', ui: { itemSelectorVisible: !pluginRailVisible } });
};
```

**File: `packages/puck-css/src/pds/components/P1EditorSubheader.tsx`**

```typescript
<IconButton
  ariaLabel="Toggle plugin rail"
  iconName={pluginRailVisible ? "angleRight" : "angleLeft"}
  size="s"
  hasTooltip={false}
  hasBorder={false}
  aria-pressed={pluginRailVisible}
  onClick={onTogglePluginRail}
/>
```

## Investigation Done

1. User tested clicking the button - nothing happens
2. User checked browser DevTools - no class/attribute changes on `_PuckLayout-nav_1dd16_192` when clicking
3. We verified `itemSelectorVisible` is being toggled in state
4. **Conclusion**: `itemSelectorVisible` does NOT control the plugin rail navigation menu

## Next Steps Needed

1. Find what actually controls `_PuckLayout-nav_1dd16_192` visibility
2. Options to investigate:
   - Look at Puck's source code/documentation for the correct state property
   - Check if it requires custom CSS to hide/show instead of a built-in state
   - See if there's a different Puck UI state property we haven't found yet
   - Consider implementing a custom DOM manipulation solution if Puck doesn't expose this control

## Key Files

- `packages/puck-css/src/editor/plugin/P1Plugin.tsx` - State management
- `packages/puck-css/src/pds/components/P1EditorSubheader.tsx` - Toggle button UI
- `packages/puck-css/src/pds/components/P1EditorSubheader.module.css` - Styles

## Context Links

- User said "you messed up" - I learned to ask what's wrong instead of guessing ✓
- This is NOT about replacing existing functionality - we need to ADD a new toggle
- The three panels are independent and should all work simultaneously
