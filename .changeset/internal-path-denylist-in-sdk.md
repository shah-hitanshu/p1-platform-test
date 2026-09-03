---
"@pantheon-systems/p1-next-sdk": minor
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** `loadPublishedPage()` now refuses internal document namespaces itself, so `/_registry/**` and `/_redirects/**` 404 on a published site even when the app's `page.tsx` carries no denylist of its own.

### What Changed

- The check used to live in the scaffolded catch-all route (`app/[...puckPath]/page.tsx`), duplicated across `generateMetadata` and the page body. That file is forkable user land: a project that rewrote or tidied it exposed every registry and redirect document as a live public page. Like the other invariants in `published-page.ts` — awaited init, miss-versus-outage, aborted prerender — this one belongs in the SDK.
- Internal paths report `{ status: "missing" }` without reaching the backend, so the renderer's existing `notFound()` handling covers them with no extra code.
- Matching is case-insensitive and on segment boundaries: `/_Redirects/x` is refused (the server lower-cases document paths before lookup, so it resolves the same record), while a real page at `/_registry-guide` still renders.
- Scaffolded projects no longer ship `isInternalPath`. Existing projects keep working either way — a leftover local copy is now redundant, not harmful.

### Migration / Action Required

None. To reserve additional namespaces of your own, pass them to `loadPublishedPage`:

```ts
const result = await loadPublishedPage(path, {
  internalPathPrefixes: ["/_private"],
});
```

The option adds to the built-in list rather than replacing it, so a short list cannot un-block `/_registry`.
