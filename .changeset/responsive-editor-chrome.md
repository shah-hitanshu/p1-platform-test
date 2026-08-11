---
'@pantheon-systems/puck-css': minor
---

The editor chrome is now **responsive**. The plugin rail (Blocks / Outline / History / AI)
is permanent — it no longer defaults to hidden behind a toggle, so the panels are visible
on a first visit. Its toggle button and the `p1-plugin-rail-<siteId>` localStorage key are
both removed; stale values for that key are ignored.

Horizontal space is governed by one rule: the canvas never drops below 600px, and chrome
yields in priority order as the window narrows. The left panel auto-collapses below 1308px
and the right follows below 988px, with thresholds derived from the real chrome dimensions
rather than fixed breakpoints. Auto-management only ever reopens a panel it closed itself —
a panel the author closed stays closed at any width. The panel preference is written only at
widths where nothing is auto-collapsed, so a narrow session never overwrites a wide-screen
preference. Puck mounts with the budget-constrained visibility, so a narrow first load no
longer paints both panels open and then snaps them shut.

The preference key drops its site suffix: `p1-sidebar-<siteId>` becomes `p1-sidebar`, since
localStorage is already origin-scoped and an origin serves a single site. The `{ left, right }`
shape is unchanged, but the rename means an existing saved preference is not carried over —
authors get the default (both panels open) once, then their next change sticks.

The historical-version preview banner stays exactly one line tall at every canvas width.
Its label truncates with an ellipsis (full text on hover) instead of wrapping the action
row onto a second line, and it renders outside Puck's scaled preview wrapper so it measures
the real canvas. The version steppers gain "Previous Version" / "Next Version" tooltips,
suppressed while disabled or while a revert is in flight.
