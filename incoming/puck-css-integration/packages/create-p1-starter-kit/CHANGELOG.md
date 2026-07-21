# @pantheon-systems/create-p1-starter-kit

## 0.7.0

## 0.6.0

### Patch Changes

- 986075f: Add the LaunchDarkly-gated `p1-chatbot` AI assistant to the starter-kit editor. The chatbot renders only when the `p1-chatbot` LaunchDarkly flag is enabled and an agent URL is configured, so scaffolded sites ship with it off by default until opted in.

## 0.5.0

### Patch Changes

- efb961d: Fix the starter kit's auth route forcing Google's full re-authentication screen on every login (`prompt: 'login'`), even with a live browser session. Sites scaffolded via `create-p1-starter-kit` now use `prompt: 'select_account'`, so an existing Google session is reused with a lightweight account-chooser step instead of forcing full re-auth, while still letting users switch accounts on logout/login.

## 0.4.4

### Patch Changes

- Fix editing the root "/" homepage from the editor page switcher: selecting the homepage now opens the editor instead of navigating to the dashboard, and all pages route through a single `/p1/` separator via `editorPathHref` (also fixing non-root page links).

## 0.4.3

### Patch Changes

- Bug fixes and improvements: deferred branch detection for read:published tokens, init promise retry, production backend URL handling, editor top menu UI improvements.

## 0.4.2

### Patch Changes

- dc7cfd7: Fix packages being published with unresolved workspace:\* references by switching from npm publish to pnpm publish. Fix starter kit CLI to show "npm run dev" instead of "npm dev" for npm users.
