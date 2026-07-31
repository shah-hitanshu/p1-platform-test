---
"@pantheon-systems/puck-css": minor
---

Adds a visual component sidebar: Puck's default component list is replaced with collapsible categories of real, live-rendered preview cards, based on each component's `defaultProps`. This is the default drawer for every `puck-css` editor — opt out via `useP1Editor`'s `liveThumbnailDrawer: false`. Also insets the editor canvas with a grey gutter and a slightly rounded page.

Previews are cached in-memory per session (not persisted to localStorage — the cache feeds `dangerouslySetInnerHTML`, and localStorage is writable by any same-origin script) so identical cards aren't re-rendered on category re-expand or document switch. Each preview renders through an isolated config with a pass-through page root, so it shows only the component itself rather than the real, currently-open document's page chrome.
