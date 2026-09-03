---
"@pantheon-systems/p1-next-sdk": patch
---

**[Fix]** Opening the editor at a page that does not exist no longer does nothing.

### What Changed

- The starter's editor POSTed to `/p1/api/structure/page` when a page was missing. No handler ever served that route, so the request 404'd and the failure was swallowed — navigating to a new editor path silently did nothing. The editor now shows a page-not-found panel in the canvas offering to create the page.
- `p1-migrate` strips the dead call. An app that customized the region is left alone and reported, as with the codemod's other edits.
