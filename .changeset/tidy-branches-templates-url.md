---
"@pantheon-systems/css-client": patch
"@pantheon-systems/puck-css": patch
---

Stop the editor from requesting a templates URL with an empty branch segment.

`useTemplateList` no longer fetches until a branch is resolved, matching `useDocuments`,
so the editor waits for `P1PuckProvider` to resolve the site's main branch rather than
calling through with an empty branch id. css-client rejects a blank or missing path
parameter with a `MissingParameterError` naming it — a `P1ApiError` carrying status 400,
so existing bad-request handling and retry predicates treat it correctly — instead of
emitting a URL the API misparses (`/branches//templates`, which something upstream
collapses into `/branches/templates`, reported back as `Branch not found: "templates"`).

The single-resource getters (`branches.get`, `sites.get`, `queries.get`,
`checkpoints.get`, `merge.getRequest`, `agentRegistry.get`) carry the same check, because
a blank *trailing* parameter leaves one slash the API strips — so `branches.get(siteId,
'')` used to return the branch *list* typed as a single `Branch`, with no error anywhere.

A blank or whitespace `CSS_BRANCH_ID` / `NEXT_PUBLIC_CSS_BRANCH_ID` now reads as unset on
every path that consumes it, including the content client, where it previously reached
`?branch=` and 404'd every published page.
