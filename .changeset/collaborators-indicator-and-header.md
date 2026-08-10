---
'@pantheon-systems/puck-css': minor
---

The live collaborators indicator in the editor header is reworked. Collaborators now show
as a stacked row of avatars with initials derived from the display name, a stable
per-person colour, and an overflow count once the stack is full, so who's in the document
is readable at a glance instead of a flat list. Presence identity is resolved from a single
place, so the same person no longer appears twice after a reconnect.

The editor header and subheader are restyled to match the design prototype: tighter
spacing, aligned action groups, and the document-state badge moved in beside the title.
