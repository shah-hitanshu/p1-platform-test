---
"@pantheon-systems/puck-css": patch
---

Fixes the editor canvas and preview rendering the *previously* selected workstream's document after a workstream switch. Deterministic, and it never self-corrected. Also fixes the first document of a cold load being dropped, which is what left you one behind before any switch had happened.

The document sync key described which document had been **requested** rather than which one was **in hand**. `documentSyncKey(branchId, documentId)` was built from the live `css.branchId` while the data was read from a ref, and those come from different clocks: `switchBranch` commits the branch synchronously but only clears `currentDocument`/`currentData` later, in an async phase that awaits any in-flight switch plus a save-flush, and `documentLoading` is written only inside `loadDocument` so it stays `false` throughout. In that window the publish effect re-ran and published the incoming branch's key beside the outgoing branch's data. The sync plugin applied that pairing and recorded the new key as applied, so the correct document — arriving moments later under the same key — was skipped as already applied.

Every payload the provider emits now carries the identity it was loaded under, committed in the same render pass as the data itself, and both the sync key and the data are derived from that one record. A new key paired with a different document's data is no longer guarded against; it is unrepresentable.

The plugin's "first document observed is already on the canvas" special case is gone, replaced by an explicit `BLANK_SYNC_KEY` sentinel. That premise was false: Puck mounts with blank data and the branch is restored from `sessionStorage` *after* mount, so the first correct payload was being swallowed. `ContextSyncBridge` now stands down unless the applied key matches the current document exactly, since the plugin owns the first document too.

This also repairs the autosave write-back guard, which the bug had defeated. Both sides of its comparison read the new branch's key while the canvas still held the old branch's content, so it waved the save through — meaning an edit made right after a switch could write one workstream's content into another workstream's document. The applied key now genuinely means "what the canvas shows", so the guard drops those saves as intended.

Puck is deliberately **not** remounted on a switch. Keying it by branch or document would fix the staleness by tearing down the preview iframe and re-parsing all canvas styles on every switch, which is the lag the sync store exists to avoid.

No API change for consumers: `P1PuckContextValue` gains an optional `currentDataOrigin`, and the sync store's types are internal to the package.
