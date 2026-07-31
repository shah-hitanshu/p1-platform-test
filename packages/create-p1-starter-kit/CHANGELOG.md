# @pantheon-systems/create-p1-starter-kit

## 0.8.0

### Minor Changes

- 5075a8a: Sites scaffolded via `create-p1-starter-kit` now include the `@pantheon-systems/p1-media` plugin by default, alongside the existing plain-URL `ImageBlock`. A new `MediaFigureBlock` component adds a real versioned media library and asset picker (metadata, alt text, cropping) to the "Media" category. The plugin is on by default with no feature flag; `siteId`/auth resolve automatically from the ambient P1 editor context. Set `NEXT_PUBLIC_MEDIA_BASE_URL` to override the CDN origin used for URL validation in non-production deployments (defaults to the production origin).

### Patch Changes

- Minimum supported Node.js is now 24. The `engines.node` field on these packages moved from `>=18.0.0`/`>=20.12.0` to `>=24.0.0`, so installs on older Node will warn (or fail, depending on your package manager's `engine-strict` setting).
- `ParagraphBlock` in the scaffolded template now uses `richtextField` from `@pantheon-systems/puck-css/fields` instead of a textarea plus ReactMarkdown, enabling inline canvas editing, TipTap-backed rich text, AI generation hints, and the shared Bold/Italic/Underline/BulletList/OrderedList menu with no per-block configuration. Because the richtext field stores HTML rather than markdown, the render path sanitizes it through a shared SSR-safe sanitizer (allowlisting inline formatting, lists, and safe-protocol links) before it reaches `dangerouslySetInnerHTML`. The template also registers `@tailwindcss/typography` so `prose` list markers render under Tailwind v4 Preflight.

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
