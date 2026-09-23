---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/p1-next-sdk": minor
---

**[Breaking Change]** The frontend role model is gone. `ContentRole`, the `userRole` prop, and the SDK's dev `RoleSwitcher` are removed. The editor gates every control on the `RolePermissions` flags the backend returns; the backend's role definitions are the only source of what a role can do.

### What Changed

- Removed from `@pantheon-systems/puck-css`: the `ContentRole` type, `getPermissionsForRole`, `canPerformStructuralAction`, `canEditProps`, `canOverrideUrl`, `mergePermissions`, `useContentRole`, `useTemplatePermissions`, `mapCssRoleToContentRole`, and the `userRole` prop on `P1PuckProvider`, `P1Config` and `createNextConfig`.
- `useResolveContentRole` is now `useResolvePermissions` and also returns `roleName`.
- `useP1Puck()` no longer exposes `userRole`. It exposes `permissions` (`RolePermissions | null`), `permissionsOutcome`, and `roleName` (`'ADMIN' | 'EDITOR' | 'VIEWER' | 'NO_ACCESS' | null`) for display and logging.
- `createPuckPermissions(template, canEditDocuments, isHistoricalVersion, canEditProps?)` takes the backend flag instead of a role string.
- Removed from `@pantheon-systems/p1-next-sdk`: `RoleSwitcher`, and the `userRole` and `roleSwitcher` options on `createP1EditorClient`.

### Migration / Action Required

- Stop passing `userRole` and `roleSwitcher`. Nothing replaces them — the editor resolves its own permissions.
- Gate custom UI on flags, not names:

```tsx
// Before
const { userRole } = useP1Puck();
const canPin = userRole === 'admin';

// After
const { permissions } = useP1Puck();
const canPin = permissions?.canManageTemplates ?? false;
```

- To show the user's role, read `roleName` from `useP1Puck()`. Never branch behaviour on it.
- To test a role locally, grant that role on the site, or edit the `/auth/role` stub in your mock server.
