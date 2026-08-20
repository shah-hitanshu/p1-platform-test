---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The Puck canvas no longer remounts when editor-context data resolves, so selection, scroll position, and in-progress field edits survive initial load and branch switches.

### What Changed

- `useP1Plugins` now returns its plugin array synchronously instead of returning `[]` until the editor-context fetch resolved. The array's identity was changing mid-load, and Puck treats its plugin list as identity-sensitive config, so every load remounted the whole canvas.
- The field-connect ("Bind") modal now reads live routes and remote datasources itself rather than the values captured when the plugin was created, so its route/datasource list stays current after a branch switch instead of showing whatever was available at plugin-creation time.
- **[Deprecation]** `createFieldConnectPlugin`'s `routes` and `remoteDatasourceRegistry` options are deprecated. They are now only a fallback used until live data loads.

### Migration / Action Required

Nothing is required — the deprecated options still work.

If you render the published `EditorClient` outside a `P1PuckProvider`, its Bind modal now fetches `/p1/api/editor-context` itself and prefers that result over the `routes`/`remoteDatasourceRegistry` you pass in. Make sure your host app serves that route; if it doesn't, the modal still falls back to your props, but each mount will retry the request first.

Drop the two options once you are on this version:

```diff
  createFieldConnectPlugin({
    config,
    editorPath,
-   routes,
-   remoteDatasourceRegistry,
  })
```
