---
"@pantheon-systems/p1-next-sdk": minor
---

The P1 editor now renders from a persistent `Layout` instead of the catch-all `Page`, so navigating between documents no longer remounts the whole editor (providers, auth, and the Puck canvas iframe). `createP1Pages()` returns a `Layout` that renders the editor, `Page` is intentionally empty, and `EditorClient` is rendered with no props — it derives the edited page from the URL via the new `editorPagePathFromUrlPath` export.

This is a breaking change for existing apps: the editor must be mounted from an `(editor)` route group. If you upgrade but keep only the old `app/p1/[[...p1]]/page.tsx`, the editor renders blank (TypeScript apps get a compile error from the changed `EditorClient` prop type; JavaScript apps get no signal, plus a one-time dev warning). New scaffolds from `create-p1-starter-kit` are unaffected.

To migrate an existing app, run the codemod shipped with this release:

```bash
npx @pantheon-systems/p1-next-sdk p1-migrate
```

It restructures the routes for you (clean-tree gated, `--dry-run` supported, idempotent) and bails to the manual guide if your files diverged from the starter shape. See `docs/MIGRATION-EDITOR-LAYOUT.md` for the full guide and manual steps.
