---
'@pantheon-systems/puck-css': patch
---

Editor icons render at their intended size again. `pds-toolkit-react` renamed `<Icon>`'s
`iconSize` prop to `size` in `2.0.0-alpha.43`, but puck-css was bumped past that release
still passing `iconSize` at 18 call sites. Because `Icon` spreads unrecognised props onto
the underlying `<svg>`, the size was silently dropped — icons fell back to the component
default and React logged a "does not recognize the `iconSize` prop on a DOM element"
warning on every render.

The bundled type declarations for `pds-toolkit-react` had also kept the old prop name, which
is why TypeScript never flagged it. They now match the real component and type `size` as
the proper `IconSize` union, so both a stale prop name and an invalid size fail to compile.
