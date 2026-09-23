---
"@pantheon-systems/puck-css": minor
---

**[Breaking Change]** The editor now resolves the current user's role from the backend before rendering, rather than accepting it as a prop.

### What Changed

- `P1PuckProvider` calls `client.auth.getRole(siteId, branchId)` on mount and keeps the returned `RolePermissions` as the only authorization input.
- The editor stays in a loading state until the permission check completes. If the check returns `refused` or `unavailable`, `useP1Editor` surfaces an error instead of opening the canvas.
- `useP1Puck()` now exposes two new context values: `permissions` (`RolePermissions | null`) and `permissionsOutcome` (`'pending' | 'granted' | 'refused' | 'unavailable'`).

### Migration / Action Required

If you passed a `userRole` prop to `P1PuckProvider` or `P1App` to control the editing role, remove it — the backend advisory endpoint is the authority and the prop no longer exists.

```tsx
// Before
<P1App config={{ ...p1Config, userRole: 'editor' }} />

// After — role is resolved automatically; no prop needed
<P1App config={p1Config} />
```

If you read `userRole` from `useP1Puck()` to gate UI, read the matching `permissions` flag instead (`canEditDocuments`, `canManageTemplates`, …). Wait for `permissionsOutcome === 'granted'` before acting on it if you need the settled value.
