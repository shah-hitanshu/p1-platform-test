---
"@pantheon-systems/puck-css": patch
---

Fixes an editor crash (`RangeError: Empty text nodes are not allowed`) on any page whose blocks omit a rich-text prop that the component defaults to `""`. Puck merges `defaultProps` underneath stored props on every render, so an omitted rich-text key inherits its default; Puck's `RichTextRender` then wraps that non-HTML string as `{type:"text", text:""}`, and prosemirror-model rejects a zero-length text node. That render path has no error boundary, so a single bad prop takes down the whole subtree and the page appears not to load. `undefined` normalizes to an empty document and renders fine, so an absent value is safe and `""` is not.

New `sanitizeRichtextDefaults` strips empty-string defaults from `richtext` fields in a Puck config, walking nested `objectFields`/`arrayFields` since rich text commonly lives inside array items. It returns the input by reference when there is nothing to strip, so it cannot break Puck's memoization on config identity. Applied inside `wrapConfigForEditorPreview`, which every P1 editor surface already routes through, so consumers are covered without an app-side change; also exported for direct use. This additionally fixes the component drawer, whose live thumbnails render each component from `defaultProps` alone and so crashed independently of any document (PCC-3589).
