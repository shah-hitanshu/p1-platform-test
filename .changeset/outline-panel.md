---
'@pantheon-systems/puck-css': minor
---

The editor's layer list is replaced by a new **Outline panel**. It shows the page's
component tree with each component's own icon, keeps the selected component in sync with
the canvas, and supports drag-to-reorder within a level. Components that don't declare an
icon fall back to a name-derived one, so the tree stays readable for custom blocks.

The panel chrome is now shared and exported, so plugin panels can match it without
re-implementing the frame: `PanelShell` (scroll container + borders), `PanelHeader`
(title, optional actions), and `OutlinePanel` itself are available from
`@pantheon-systems/puck-css/editor`, along with the `PanelShellProps` and
`PanelHeaderProps` types.
