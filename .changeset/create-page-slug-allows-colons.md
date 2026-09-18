---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The "Create a new page" modal's URL slug field no longer strips `:` while typing, so a dynamic route segment (e.g. `:category`) can be entered directly instead of only via the MCP/API.

### What Changed
- `sanitizeSlug` in `CreatePageModal` allowed only `a-z0-9-`, silently dropping `:` on every keystroke. It now also allows `:`, matching the CCR backend's own path validation, which never restricted paths to alphanumerics-and-hyphen in the first place.
