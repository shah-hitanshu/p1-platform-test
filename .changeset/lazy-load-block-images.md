---
"@pantheon-systems/puck-css": patch
"@pantheon-systems/p1-media": patch
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** Block images now lazy-load by default, so image-heavy pages stop fetching every image regardless of viewport.

### What Changed

- `MediaImage` and `MediaFigure` render `loading="lazy"` + `decoding="async"` unless the caller passes `loading`, so custom blocks built on them inherit the behavior.
- `createMediaFigureBlock` gained a "Loading" field (Lazy/Eager) whose default comes from the new `defaultLoading` option.
- The data-list block's Cards/Rows/Listing layouts lazy-load item images, with a new "Image loading" field to opt an instance into eager.
- The starter's primitive Image block gained the same Lazy/Eager field.

### Migration / Action Required

Lazy loading applies retroactively: existing documents pick it up without being re-saved, so a published page whose LCP element is a hero or first-row listing image will load that image lazily after upgrading, and its LCP may regress until an editor opts back in. Set the block's loading field to "Eager" on above-the-fold images to restore the previous behavior.
