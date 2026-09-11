---
"@pantheon-systems/p1-next-sdk": minor
---

**[Feature]** `createP1EditorClient` builds the editor shell, so a project's editor route becomes a short caller instead of a frozen copy of the wiring.

### What Changed
- A new client export assembles the providers, document loading, branch-switch reload overlay, last-good-state handling and post-login redirect that every P1 editor needs. Improvements to any of it now reach an existing project on a package update rather than only new scaffolds.
- What actually differs per project flows in as options: the Puck config, a sign-in page, extra plugins and plugin options, editor overrides, a wrapper around the editor, and the content role to open as.
- `useExtensions` is a hook slot for customization that has to be computed at render — a plugin built from a feature flag, an option derived from app state. It returns plugins, plugin options, override options and an optional editor key suffix, and is called inside the editor so it may use hooks of its own.
- The dev role picker ships with the SDK behind `roleSwitcher`, and its options are now derived from the `ContentRole` type rather than hand-listed — the hand-written list had gone stale and was missing `author`.
- One stylesheet entry point, `@pantheon-systems/p1-next-sdk/editor.css`, replaces the two `puck-css` imports an editor route used to carry. Import it from the route that mounts the editor; the SDK owns what goes in it from now on.
- The page stashed before sign-in is now honoured only when it resolves to this same origin, so a value written into browser storage by anything else on the origin cannot redirect the editor off-site after login. It is resolved with the URL parser rather than prefix-matched, because the parser discards tab, LF and CR and a value like `/\t/example.com` otherwise reads as a path while navigating away.
