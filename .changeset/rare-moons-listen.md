---
"@pantheon-systems/puck-css": patch
---

Report editor boot failures instead of hanging on "Loading document". `useP1Editor` never starts a document load until a branch resolves, and `P1PuckProvider` dropped both ways that can fail: a refused `GET /api/sites/{siteId}/branches`, and a list that resolves without a usable branch (which is what the API returns for a site id that doesn't exist). The provider now exposes `branchResolutionError`, naming the request and its HTTP status, and the editor reports it as a fatal load error. A refused document list is also no longer reported as "No documents found on this branch" — the provider exposes `documentsError` and the real failure is shown instead.
