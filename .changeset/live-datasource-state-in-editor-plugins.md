---
"@pantheon-systems/puck-css": minor
---

Fixes the datasource explorer panel being stuck on its loading skeleton, and the canvas never resolving `{{ source.field }}` tokens, on any editor built with `useP1Editor`.

Puck receives its plugin array once per mount. `useP1Editor` keeps that array identity-stable on purpose — new plugin objects mean new override component identities, which remounts the canvas and every field, losing focus mid-keystroke — so it rebuilds only when the plugin *count* changes. That made every value a plugin factory closed over permanently frozen. The count changes exactly once, when the editor context arrives and `useP1Plugins` goes from zero plugins to three; the datasource registry only exists at that moment, so the context fetch it triggers is still in flight. The explorer plugin captured `snapshot: {}` and `loadingIds: Set(["…"])`, the preview-resolve plugin captured the same empty context, and the settled data that arrived milliseconds later was rebuilt into fresh plugin objects that Puck never saw. A warm react-query cache hid the bug, since the data was already present at freeze time.

Plugin-rendered components now read datasource state through the new `useLiveRemoteDatasources` hook instead of receiving it by value. `P1QueryProvider` already wraps the whole editor, so this subscribes them to the same react-query entries the editor host reads: data, loading state, registry, and preview params all stay live without anything crossing the plugin boundary, and the array stays identity-stable. This also fixes the panel pointing at a stale document path after navigating between pages, since the path now comes from `P1PuckContext` rather than the captured `editorPath`.

**Breaking:** the data arguments those factories took are removed rather than deprecated, since passing them by value could never have worked. `createRemoteDatasourceExplorerPlugin` and `createPreviewResolvePlugin` now take a single options object — drop the leading context argument, and drop the `routeTemplateKeys`, `savedPreviewParams`, `remoteDatasourceRegistry`, `loadingIds`, and `loading` options; all of that is read live. `Client`'s `remoteDatasourceContext`, `routeTemplateKeys`, and `savedPreviewParams` props are removed for the same reason.

```diff
- createPreviewResolvePlugin(remoteDatasourceContext, { editorPath, loading })
+ createPreviewResolvePlugin({ editorPath })
- createRemoteDatasourceExplorerPlugin(snapshot, { editorPath, routeTemplateKeys, savedPreviewParams, remoteDatasourceRegistry, loadingIds })
+ createRemoteDatasourceExplorerPlugin({ editorPath })
```
