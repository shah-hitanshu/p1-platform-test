---
"@pantheon-systems/puck-css": minor
---

**[Feature]** The editor now tells you when a page does not exist and offers to create it, instead of failing silently.

### What Changed

- Opening the editor at a path with no page renders a "This page doesn't exist" panel in the canvas — the header, page navigator and side panels stay in place around it. It offers **Create page** to users whose role permits it, and **Open home page** to everyone. It replaces the generic "Choose a page from the menu above" empty state for this case only.
- The flow is self-contained: `useP1Editor` creates the page and re-opens it. No wiring is required beyond what an editor already passes.
- `useP1Editor` returns `notFound: true` when the path lookup finds no page on the current branch. Previously that case surfaced as a load error. It is reported separately because nothing has failed — the page simply is not there yet. Only the path lookup counts: a 404 from a later call in the same load (a missing version, say) stays an error, so the panel never offers to create a page that already exists. `retry()` is also returned, for consumers rendering their own panel.
- `onDocumentNotFound` is unchanged and still takes priority: a callback returning `true` retries the load, and `notFound` stays `false`.

### Migration / Action Required

None. Drop any `onDocumentNotFound` auto-create callback to adopt the new flow.
