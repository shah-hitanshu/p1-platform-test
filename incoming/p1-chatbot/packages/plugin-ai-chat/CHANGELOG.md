# @pantheon-systems/p1-ai-chat

## 0.1.1

### Patch Changes

- e13ebba: Add automated release workflow using changesets. Merging changesets to `main`
  now opens a "Version Packages" PR; merging that PR publishes to npm via OIDC
  trusted publishing.
- 9494997: Widen the pds-toolkit-react peer range to >=2.0.0-alpha.0 and migrate the plugin
  to the alpha.43 Icon/Badge API (iconSize->size, gaia->success), so the plugin
  installs cleanly in workspaces on newer PDS alphas.
