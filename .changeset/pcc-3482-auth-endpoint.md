---
"@pantheon-systems/css-client": minor
---

**[Feature]** Added `client.auth.getRole(siteId, branchId)` — an advisory endpoint that returns the calling user's role and permission flags on a branch.

### What Changed

- New `AuthEndpoint` accessible as `client.auth`, with a single `getRole(siteId, branchId)` method.
- New exported types: `RoleName`, `RolePermissions`, and `ViewerRole`.
- The endpoint calls `GET /api/sites/{siteId}/branches/{branchId}/auth/role` and returns the server's view of the caller's permissions. It is advisory — the server enforces the same rules on every write regardless of what this endpoint returns.
