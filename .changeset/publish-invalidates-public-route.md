---
"@pantheon-systems/p1-next-sdk": minor
"@pantheon-systems/puck-css": minor
---

**[Fix]** Publishing now invalidates the public route it changed, so a page reaches the site immediately instead of waiting out the app's revalidate window.

### What Changed

- The editor publishes to the backend directly, so nothing in the request path told the Next.js app that one of its cached renders had gone out of date. The public page segment is statically renderable, so the app kept serving what it had — for up to `revalidate` seconds, and with a `stale-while-revalidate` window that lets a CDN in front of it serve the same stale render for far longer.
- The case that made this visible: a path requested before its page existed has a `notFound()` render cached against it. Creating and publishing that page left the cached 404 in place, so a page that had published correctly, and was listed in the site structure, was not reachable on the site.
- `createP1Handler` gains a `revalidate` POST action (`POST /p1/api/revalidate` with `{ path }`), auth-wrapped like `publish`. It only invalidates — the content is already in the backend, and re-persisting it here would give one page two write paths.
- `useP1Editor` calls it after a successful publish, awaited before `onPublishSuccess` fires: until it returns, the public route can still be serving pre-publish content. A failed invalidation is reported as a stale route, never as a failed publish — the publish has already committed by then.
- Route-template fan-out (overrides plus the public catch-all segment, for instance URLs that resolve by template fall-through) is shared with the `publish` action rather than duplicated, so the two cannot drift.

### Migration / Action Required

None for apps whose P1 handler is mounted at `/p1/api` from `createP1Handler` — the new action is served automatically and the editor calls it on its own.

An app that renders public pages from a segment other than `[...puckPath]` should already be passing `publicPageSegment` to `createP1Handler`; the new action honors the same option.
