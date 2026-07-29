# @pantheon-systems/p1-next-sdk

## 0.8.0

### Minor Changes

- 3ed945e: The P1 editor now renders from a persistent `Layout` instead of the catch-all `Page`, so navigating between documents no longer remounts the whole editor (providers, auth, and the Puck canvas iframe). `createP1Pages()` returns a `Layout` that renders the editor, `Page` is intentionally empty, and `EditorClient` is rendered with no props — it derives the edited page from the URL via the new `editorPagePathFromUrlPath` export.

  This is a breaking change for existing apps: the editor must be mounted from an `(editor)` route group. If you upgrade but keep only the old `app/p1/[[...p1]]/page.tsx`, the editor renders blank (TypeScript apps get a compile error from the changed `EditorClient` prop type; JavaScript apps get no signal, plus a one-time dev warning). New scaffolds from `create-p1-starter-kit` are unaffected.

  To migrate an existing app, run the codemod shipped with this release:

  ```bash
  npx @pantheon-systems/p1-next-sdk p1-migrate
  ```

  It restructures the routes for you (clean-tree gated, `--dry-run` supported, idempotent) and bails to the manual guide if your files diverged from the starter shape. See `docs/MIGRATION-EDITOR-LAYOUT.md` for the full guide and manual steps.

### Patch Changes

- `@pantheon-systems/css-client` and `@pantheon-systems/puck-css` are no longer declared as `peerDependencies`; they remain regular `dependencies`. The four suite packages are a lockstep group that always publishes at one version, so the peer edge duplicated a guarantee lockstep already provides — and caused every non-patch release to escalate the whole suite to a major bump. `peerDependencies` is now external-only (`react`, `react-dom`, `next`, `@puckeditor/core`). Consumers should continue to pin all suite packages at the same version.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @pantheon-systems/puck-css@0.8.0
  - @pantheon-systems/css-client@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [b0254ff]
- Updated dependencies
- Updated dependencies [e937842]
- Updated dependencies [e937842]
  - @pantheon-systems/puck-css@0.7.0
  - @pantheon-systems/css-client@0.7.0

## 0.6.0

### Patch Changes

- @pantheon-systems/css-client@0.6.0
- @pantheon-systems/puck-css@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [0bc7982]
  - @pantheon-systems/css-client@0.5.0
  - @pantheon-systems/puck-css@0.5.0

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).
- Updated dependencies
  - @pantheon-systems/puck-css@0.4.4

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.
- Updated dependencies
  - @pantheon-systems/puck-css@0.4.3

## 0.4.2

### Patch Changes

- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
- Updated dependencies [6650602]
- Updated dependencies [dc7cfd7]
  - @pantheon-systems/puck-css@0.4.2
