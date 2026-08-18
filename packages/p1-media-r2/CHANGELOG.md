# @pantheon-systems/p1-media

## 0.4.4

### Patch Changes

- 863bff6: **[Fix]** Block images now lazy-load by default, so image-heavy pages stop fetching every image regardless of viewport.

  ### What Changed
  - `MediaImage` and `MediaFigure` render `loading="lazy"` + `decoding="async"` unless the caller passes `loading`, so custom blocks built on them inherit the behavior.
  - `createMediaFigureBlock` gained a "Loading" field (Lazy/Eager) whose default comes from the new `defaultLoading` option.
  - The data-list block's Cards/Rows/Listing layouts lazy-load item images, with a new "Image loading" field to opt an instance into eager.
  - The starter's primitive Image block gained the same Lazy/Eager field.

  ### Migration / Action Required

  Lazy loading applies retroactively: existing documents pick it up without being re-saved, so a published page whose LCP element is a hero or first-row listing image will load that image lazily after upgrading, and its LCP may regress until an editor opts back in. Set the block's loading field to "Eager" on above-the-fold images to restore the previous behavior.

## 0.4.3

### Patch Changes

- 74dda98: Adds a README to every published package. Each one rendered a blank page on npmjs.com, because
  no `README.md` existed in the package directory to be included in the tarball — npm renders the
  README from the published tarball, not from the source repository, so a private repo was never
  the cause.

  Also repoints every `repository` URL at `pantheon-systems/p1-platform` with the correct
  `directory`. They still referenced the pre-merge repositories (`puck-css-integration`,
  `collaborative-state-system`, `p1-media-r2`), so the "Repository" link on each npm page went
  nowhere. Adds a matching `homepage` for each package.

  No runtime code changes.
