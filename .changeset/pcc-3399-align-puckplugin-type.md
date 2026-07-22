---
"@pantheon-systems/p1-ai-chat": patch
---

fix(PCC-3399): align exported plugin type with @puckeditor/core's real `Plugin`

`createAIChatPlugin()` and the exported `PuckPlugin` type now reuse `@puckeditor/core`'s `Plugin` type directly instead of a hand-maintained local interface that declared an invalid `mobilePanelHeight: 'full'` value (the real union is `'toggle' | 'min-content'`). This lets consuming apps drop the `as`-cast workaround when merging the plugin into Puck's `additionalPlugins`, and prevents future drift from the upstream type.
