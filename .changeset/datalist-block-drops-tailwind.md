---
"@pantheon-systems/puck-css": minor
---

The DataList block's builtin display components (Grid/Cards, List/Listing, Table/Rows) and the block shell around them no longer render with Tailwind utility classes. They now use semantic `p1-datalist-*` class names from a stylesheet the components import themselves, so correct rendering no longer depends on a consumer's Tailwind build scanning this package's `dist`.

Every colour, space, radius, border width, font size, and font weight is driven by a `--p1-datalist-*` custom property that resolves to the matching PDS design token, falling back to a literal for hosts that don't load PDS. Hosts can retheme the block by overriding those properties. The components deliberately set no `font-family`, so type inherits from the host page. Layouts are visually unchanged.
