---
'@pantheon-systems/puck-css': patch
---

**[Fix]** `P1App` now supplies the context `@pantheon-systems/pds-toolkit-react` overlays need, so a `Modal` rendered anywhere in the editor — including the chat attachment preview, or your own children — no longer crashes on versions before `2.0.0-alpha.42`.
