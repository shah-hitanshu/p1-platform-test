# @pantheon-systems/p1-next-sdk

## 0.6.0

### Patch Changes

- @pantheon-systems/css-client@0.6.0
- @pantheon-systems/puck-css@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [0bc7982]
  - @pantheon-systems/css-client@0.5.0
  - @pantheon-systems/puck-css@0.5.0

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).
- Updated dependencies
  - @pantheon-systems/puck-css@0.4.4

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.
- Updated dependencies
  - @pantheon-systems/puck-css@0.4.3

## 0.4.2

### Patch Changes

- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
- Updated dependencies [6650602]
- Updated dependencies [dc7cfd7]
  - @pantheon-systems/puck-css@0.4.2
