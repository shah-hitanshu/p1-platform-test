---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/p1-next-sdk": minor
---

Move the editor's mid-switch waiting state out of the starter app and into the SDK.

`useP1Editor` now keeps the last props that rendered, so a reload no longer blanks the canvas while the next document arrives, and it reports **why** it is reloading. New `<EditorReloadOverlay>` (backed by `LoadingOverlay` in `puck-css/pds`) renders the wait with the right copy: a workstream switch and a page switch were both announced as "Switching workstream" before, even though only one of them was.

`useP1Editor` return shape:

- `loading` now means *nothing to render yet* — the first document has neither loaded nor failed. It no longer turns on for reloads that happen behind existing content. Callers using `loading` as "a switch is in flight" should read `reloading` instead.
- `reloading: 'branch' | 'document' | null` — new.
- `hasContent: boolean` — new; whether a document has ever loaded, i.e. whether `puckProps` are worth rendering.
- `puckKey` / `puckProps` are retained across a reload rather than following the emptied context.

The `p1-migrate` codemod adopts the SDK overlay as part of the migration, so a migrated app lands on the same editor page as a freshly scaffolded one. It leaves an app that customized that region alone.

The reload reason is derived by comparing the branch the loaded document came from against the current branch, rather than latched when the branch changes. A workstream switch commits the branch and the navigation that goes with it in separate renders, so the load effect runs more than once per switch — a one-shot flag was consumed by the first run and every run after it reported a plain page switch.
