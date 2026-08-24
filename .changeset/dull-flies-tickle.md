---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The editor no longer floods the browser console with Puck's "You're using the `usePuck` method without a selector" warning.

### What Changed

- Four editor components — the ActionBar pin button, the inspector fields override, the left-rail panel header, and the template fields override — called Puck's `usePuck()` without a selector. Puck logs that warning once per mount, and these components mount on every block hover, selection change, and panel toggle, so the warning repeated constantly during normal editing.
- Each now reads only the store value it needs (`dispatch`, and `config` in the inspector) through `createUsePuck()`. As a side effect they no longer re-render on unrelated Puck state changes.

No API or behavior change; nothing to do on upgrade.
