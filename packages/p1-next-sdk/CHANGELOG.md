# @pantheon-systems/p1-next-sdk

## 0.16.0

### Minor Changes

- 209e42c: **[Feature]** The AI chatbot's rollout gate now lives in the SDK, behind a new
  `@pantheon-systems/p1-next-sdk/chatbot` entry point, so an application no longer carries
  feature-flag plumbing for it (`p1-migrate` applies the rewrite only to projects whose
  installed P1 suite is at this version or newer).

  ### What Changed
  - `P1ChatbotProvider` and `useP1Chatbot` replace the flag provider, flag key and gating
    helpers that starter projects used to keep in their own source. Whether the chatbot is
    available to a site is Pantheon's decision, so there is nothing left to branch on: an
    unavailable chatbot contributes no plugins, no `onGenerateWithAI` handler and an
    unchanged `<Puck>` remount key.
  - Retiring the rollout no longer requires a change to your project.
  - `p1-migrate` applies this rewrite to `editor-client.tsx` as part of the editor-layout
    migration, and bails rather than half-rewriting a file whose chatbot wiring you
    customized. Its output imports the new entry point, so on an older installed suite it
    says so and skips this one step, leaving your app-level gate in place and the rest of
    the migration unchanged.
  - Nothing to configure, and nothing new to opt out of: an editor that has not been given
    an agent evaluates no rollout flag and initializes no rollout client.

  ### Migration / Action Required

  Only if your project carries the old app-level gate. Run `npx @pantheon-systems/p1-next-sdk p1-migrate`,
  or apply it by hand:

  **Before**

  ```tsx
  import { useFlags } from 'launchdarkly-react-client-sdk';
  import { ChatbotFlagProvider } from '../../../../components/ChatbotFlagProvider';
  import { shouldShowChatbot, CHATBOT_FLAG_KEY } from '../../../../lib/chatbot-flag/feature-gate';

  const chatbotEnabled = shouldShowChatbot(useFlags()[CHATBOT_FLAG_KEY], agentUrl);
  ```

  **After**

  ```tsx
  import { P1ChatbotProvider, useP1Chatbot } from '@pantheon-systems/p1-next-sdk/chatbot';

  const chatbot = useP1Chatbot({ onPageCreated: handlePageCreated });
  ```

  On `createP1EditorClient`, return that result from the `useExtensions` slot and pass
  `wrapEditor: (editor) => <P1ChatbotProvider>{editor}</P1ChatbotProvider>`.

  Then delete `lib/chatbot-flag/`, `components/ChatbotFlagProvider.tsx`, and the
  `launchdarkly-react-client-sdk` and `@pantheon-systems/p1-ai-chat` entries in your
  `package.json` — the codemod leaves those for you rather than deleting files it was not
  asked to move.

- 209e42c: **[Feature]** `createP1EditorClient` builds the editor shell, so a project's editor route becomes a short caller instead of a frozen copy of the wiring.

  ### What Changed
  - A new client export assembles the providers, document loading, branch-switch reload overlay, last-good-state handling and post-login redirect that every P1 editor needs. Improvements to any of it now reach an existing project on a package update rather than only new scaffolds.
  - What actually differs per project flows in as options: the Puck config, a sign-in page, extra plugins and plugin options, editor overrides, and a wrapper around the editor.
  - `useExtensions` is a hook slot for customization that has to be computed at render — a plugin built from a feature flag, an option derived from app state. It returns plugins, plugin options, override options and an optional editor key suffix, and is called inside the editor so it may use hooks of its own.
  - One stylesheet entry point, `@pantheon-systems/p1-next-sdk/editor.css`, replaces the two `puck-css` imports an editor route used to carry. Import it from the route that mounts the editor; the SDK owns what goes in it from now on.
  - The page stashed before sign-in is now honoured only when it resolves to this same origin, so a value written into browser storage by anything else on the origin cannot redirect the editor off-site after login. It is resolved with the URL parser rather than prefix-matched, because the parser discards tab, LF and CR and a value like `/\t/example.com` otherwise reads as a path while navigating away.

- ab21a4d: **[Feature]** New `useP1ExperimentalFeatures` hook, so an application can ask whether a Pantheon feature that is still rolling out is available to the person and site in front of it.

  ### What Changed
  - `useP1ExperimentalFeatures({ userId, siteId })` returns `isEnabled(feature)` and `resolved`. `userId` may be null — while nobody is signed in, or before auth has answered, every feature reads as off.
  - Availability is resolved once per user-and-site per page load and shared by every caller, so a page with many callers makes one rollout check rather than one each. Nothing polls, and a change to a rollout reaches a reader on their next page load.
  - Everything reads as off until the check answers, and stays off if it cannot be reached, so an unfinished feature never flashes into view.
  - `siteId` is optional; without it, availability is decided for the person alone.
  - `NEXT_PUBLIC_LD_CLIENT_ID` set to an empty string opts a deployment out of rollout checks entirely, which leaves every experimental feature off.

  ### Migration / Action Required

  None. Nothing existing changes behaviour.

- 80b84d3: **[Feature]** `roleSwitcher: true` now renders a role picker defaulting to `'editor'` when no `userRole` is passed to `createP1EditorClient`. Pass `userRole` explicitly to start the picker at a different role.
- e6ebef6: **[Feature]** `p1-next-sdk` is now a unified dispatcher with two subcommands: `migrate` (was the standalone `p1-migrate` binary) and `enable-registry` (new).

  ### What Changed
  - `npx @pantheon-systems/p1-next-sdk enable-registry [dir]` writes `components.json`, creates `components/puck/blocks/index.ts`, and adds the `@/*` path alias to `tsconfig.json`, so `shadcn add @p1/…` works in a project scaffolded before the registry existed. Previously this was three files to write by hand.
  - Your files are not rewritten. A `components.json` you already have gains only the `registries` entry for `@p1`, leaving every other key as it is; the barrel, `tsconfig.json` and `puck.config.tsx` are skipped when already in place. A second run reports what it found and changes nothing.
  - `tailwind.css` points at the stylesheet your project actually has (`app/globals.css`, `src/app/globals.css` or `styles/globals.css`). When there is none to find, the command says so instead of naming a file that does not exist and leaving blocks unstyled.
  - A `tsconfig.json` is edited as text rather than parsed and rewritten, so comments and formatting survive. One with no `paths` block to extend is reported with the lines to add, rather than restructured.
  - `puck.config.tsx` is never touched — it is yours, and you have edited it. The two spreads to add are printed, along with why both must come first.
  - `p1-migrate` is no longer a standalone binary. Use `p1-next-sdk migrate` instead.

- b042b66: **[Breaking Change]** The frontend role model is gone. `ContentRole`, the `userRole` prop, and the SDK's dev `RoleSwitcher` are removed. The editor gates every control on the `RolePermissions` flags the backend returns; the backend's role definitions are the only source of what a role can do.

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

### Patch Changes

- ae68f85: **[Feature]** Experimental features can be answered locally during development, so a feature can be worked on before its rollout flag exists.

  ### What Changed
  - `NEXT_PUBLIC_P1_FLAG_OVERRIDES` answers experimental feature flags in the browser: a comma-separated list of flag keys turns each of them on, and a JSON object of flag key to boolean can also force one off. An override wins over the rollout service, and when it answers for every flag no rollout client is initialized at all.
  - The variable is read only outside a production build, so it is absent from a production bundle and cannot turn a feature on for a deployed site.

- Updated dependencies [4bc06b9]
- Updated dependencies [77112dc]
- Updated dependencies [a807a5a]
- Updated dependencies [acf6b6f]
- Updated dependencies [3dc18a5]
- Updated dependencies [9fad4f8]
- Updated dependencies [3abc827]
- Updated dependencies [f526c7c]
- Updated dependencies [81b215f]
- Updated dependencies [cd7e72f]
- Updated dependencies [3dc18a5]
- Updated dependencies [3ab591c]
- Updated dependencies [9fad4f8]
- Updated dependencies [a2f2f0d]
- Updated dependencies [c1e45fc]
- Updated dependencies [afd9a61]
- Updated dependencies [cd7e72f]
- Updated dependencies [fa0efc1]
- Updated dependencies [80b84d3]
- Updated dependencies [80b84d3]
- Updated dependencies [9d67bce]
- Updated dependencies [9633fff]
- Updated dependencies [e804afa]
- Updated dependencies [76a866f]
- Updated dependencies [b7bd802]
- Updated dependencies [6784005]
- Updated dependencies [9fad4f8]
- Updated dependencies [b5dd1bf]
- Updated dependencies [c249b47]
- Updated dependencies [87241d4]
- Updated dependencies [fb2b6c3]
- Updated dependencies [0a95233]
- Updated dependencies [b042b66]
- Updated dependencies [d46bbc0]
  - @pantheon-systems/puck-css@0.16.0
  - @pantheon-systems/p1-ai-chat@0.8.0
  - @pantheon-systems/css-client@0.16.0

## 0.15.0

### Minor Changes

- aa9979e: **[Fix]** Publishing now invalidates the public route it changed, so a page reaches the site immediately instead of waiting out the app's revalidate window.

  ### What Changed
  - The editor publishes to the backend directly, so nothing in the request path told the Next.js app that one of its cached renders had gone out of date. The public page segment is statically renderable, so the app kept serving what it had — for up to `revalidate` seconds, and with a `stale-while-revalidate` window that lets a CDN in front of it serve the same stale render for far longer.
  - The case that made this visible: a path requested before its page existed has a `notFound()` render cached against it. Creating and publishing that page left the cached 404 in place, so a page that had published correctly, and was listed in the site structure, was not reachable on the site.
  - `createP1Handler` gains a `revalidate` POST action (`POST /p1/api/revalidate` with `{ path }`), auth-wrapped like `publish`. It only invalidates — the content is already in the backend, and re-persisting it here would give one page two write paths.
  - `useP1Editor` calls it after a successful publish, awaited before `onPublishSuccess` fires: until it returns, the public route can still be serving pre-publish content. A failed invalidation is reported as a stale route, never as a failed publish — the publish has already committed by then.
  - Route-template fan-out (overrides plus the public catch-all segment, for instance URLs that resolve by template fall-through) is shared with the `publish` action rather than duplicated, so the two cannot drift.

  ### Migration / Action Required

  None for apps whose P1 handler is mounted at `/p1/api` from `createP1Handler` — the new action is served automatically and the editor calls it on its own.

  An app that renders public pages from a segment other than `[...puckPath]` should already be passing `publicPageSegment` to `createP1Handler`; the new action honors the same option.

- 0d89bb0: **[Feature]** The SEO layer moves out of the template: metadata resolution into `@pantheon-systems/p1-next-sdk/server`, the editor field definitions into `@pantheon-systems/puck-css/seo`.

  ### What Changed
  - `resolvePageMetadata()` and `buildPageMetadata()` are new exports from `@pantheon-systems/p1-next-sdk/server`. They map the stored root props (`_seo`, `_meta`) onto Next's `Metadata` — a mapping coupled to those shapes, not to a site's branding, so a copy in every scaffold could only fall behind them. The app's datasource fetcher registry is injected as `fetchers`, and `transform` gets the last word on the emitted metadata for tags a site wants to add or override — it receives the page and the authored values with any `{{ }}` already resolved, so a site can emit a tag from a field it added without resolving templates itself.
  - `createPublishedPage()` now defaults `resolveMetadata` to that resolver, passing the `fetchers` it already holds. Metadata behaviour therefore arrives with a package upgrade. Passing `resolveMetadata` still replaces the mapping outright.
  - `createSeoRootFields()` is a new export from `@pantheon-systems/puck-css/seo` (`src/data/page-metadata/`), along with `OG_TYPES`, `TWITTER_CARDS`, `DEFAULT_EDITOR_ROOT_TITLE` and the `PageMetaFields` type. It returns the `_meta` object field — the dropdown vocabularies, the help text, and the placeholders showing what an empty field inherits. puck-css owns the shape stored at `root.props._meta`, so the fields that write it now version with it.
  - **The stored `_meta` shape stays extensible.** Every field in the group templates except `ogType` and `twitterCard`, whose values are checked against a union — so a field a site adds to the group gets `{{ }}` resolution like the built-in ones, and reaches `<head>` through `transform`. Previously the templated fields were a fixed list, which is why extending the group is worth a mention: nothing about it is closed.
  - `@pantheon-systems/puck-css/seo` is its own entry point rather than part of the `/fields` barrel: `/fields` is a client module, and a Puck config is also evaluated on the server.
  - The starter's `lib/page-seo.ts`, `lib/seo-metadata.ts` and `lib/seo-metadata.consts.ts` are gone, and `components/puck/root.tsx` is down to its own title, description, and render wrapper. Rendered tags are unchanged — the suites that pinned them moved into the packages alongside the code.

  ### Migration / Action Required

  None — an app that passes its own `resolveMetadata` keeps working. To hand the metadata layer over to the packages, delete the local copies and compose the field set:

  ```tsx
  // app/published-pages.tsx — drop resolveMetadata entirely
  export const published = createPublishedPage({
    Client,
    Unavailable: ContentUnavailable,
    Fallback: WelcomeBlock,
    fetchers: REMOTE_DATASOURCE_FETCHERS,
  });

  // components/puck/root.tsx
  import { createSeoRootFields, DEFAULT_EDITOR_ROOT_TITLE } from '@pantheon-systems/puck-css/seo';

  const buildFields = (rootProps?: Record<string, unknown>) => ({
    title: { type: 'text' as const },
    description: { type: 'textarea' as const },
    ...createSeoRootFields(rootProps),
  });

  export const puckRoot = {
    fields: buildFields(),
    resolveFields: (data) => buildFields(data.props ?? {}),
    defaultProps: { title: DEFAULT_EDITOR_ROOT_TITLE },
    render: ({ children }) => <div className="font-sans antialiased">{children}</div>,
  };
  ```

  To keep site-specific tags on top of the shared mapping, wrap the resolver rather than replacing it:

  ```tsx
  resolveMetadata: (args) =>
    resolvePageMetadata({
      ...args,
      fetchers: REMOTE_DATASOURCE_FETCHERS,
      transform: (metadata, { meta }) => ({ ...metadata, keywords: meta.keywords }),
    }),
  ```

  The starter's README documents that seam under Customization, alongside adding a field to the group itself.

### Patch Changes

- 2790711: **[Fix]** `createP1Middleware` no longer requires a `cssBaseUrl` — an omitted or blank value now defaults to the production CCR backend, matching every other config path.

  ### What Changed
  - `P1MiddlewareConfig.cssBaseUrl` is now optional. Leaving `NEXT_PUBLIC_CSS_BASE_URL` unset, or set but blank, connects the middleware to the production backend instead of failing to connect at all.

- c9e7068: **[Fix]** A new project's first `npm test` no longer prints a wall of "Sourcemap for ... points to missing source files" warnings.

  ### What Changed
  - The published packages no longer ship sourcemaps. The maps referenced TypeScript sources that are not part of the published package, so bundlers warned about every one of them. Tests and builds were unaffected — the warnings were only noise.
  - Nothing to configure: update your dependencies and the warnings are gone.

- Updated dependencies [2790711]
- Updated dependencies [34b32da]
- Updated dependencies [791e6a0]
- Updated dependencies [4eca2a7]
- Updated dependencies [34b32da]
- Updated dependencies [c9e7068]
- Updated dependencies [2f64e8a]
- Updated dependencies [aa9979e]
- Updated dependencies [ac9d7b5]
- Updated dependencies [0d89bb0]
- Updated dependencies [d0206d2]
- Updated dependencies [64ac89e]
- Updated dependencies [2790711]
- Updated dependencies [998cd5b]
- Updated dependencies [d0206d2]
  - @pantheon-systems/css-client@0.15.0
  - @pantheon-systems/puck-css@0.15.0

## 0.14.0

### Minor Changes

- 3e80471: **[Feature]** `brokerLogout()` is a new public export from `@pantheon-systems/css-client`. It asks the backend for the Auth0 logout URL and hands it back, reporting one of three outcomes — it does not navigate.

  **[Fix]** Broker logout now ends the Auth0 session. Previously it only cleared the local token, so the next login signed the same user straight back in without a prompt.

  ### What Changed
  - A failed logout no longer destroys the token, so it can be retried. The signed-in user's details are kept alongside it, rather than leaving a session that reports as authenticated with nobody attached.
  - `createBrokerAuth().logout()` performs the redirect for you and returns the same three outcomes. If you call it, you need do nothing.
  - `performLogout()` from `@pantheon-systems/puck-css` clears local state and returns the outcome, but does **not** redirect — on `signed_out` the caller must navigate to `outcome.logoutUrl`, or the Auth0 session stays alive.
  - `useP1Auth().logout()` does perform that navigation for you, and now returns the outcome instead of `void`; ignoring the return value still compiles.
  - Apps mounting `createP1AuthHandler` gain a `logout` route alongside `login` and `redeem`, so logout stays same-origin instead of calling the backend directly.
  - A logout URL that is not `https:` is now rejected as an error rather than navigated to.
  - `OAuthSession.logout()` returns the outcome instead of `void`. Calling it and ignoring the result is unchanged; writing your own `OAuthSession` implementation now means returning the outcome from `logout()`.

  ### Migration / Action Required

  Only if you call `brokerLogout()` directly. It returns instead of navigating, so the redirect is yours to perform — and on `signed_out` that navigation is what actually ends the Auth0 session:

  ```ts
  const outcome = await brokerLogout({ cssBaseUrl });

  switch (outcome.status) {
    case 'signed_out':
      // Required. Without this the Auth0 session survives and the next
      // login signs the same user back in with no prompt.
      window.location.href = outcome.logoutUrl;
      break;

    case 'no_session':
      break; // Nothing to sign out of.

    case 'error':
      // The token is kept deliberately. Show the message and let the user
      // retry — clearing local state here renders them signed out while
      // they still hold a live credential.
      showError(outcome.message);
      break;
  }
  ```

- 45a272d: **[Feature]** `createPublishedPage()` is a new export from `@pantheon-systems/p1-next-sdk/server`. It builds the published-page render pipeline — read, status branch, route templates, datasource resolution, render — so route files don't have to assemble it by hand.

  ### What Changed
  - The pipeline used to be hand-written in `app/page.tsx` and `app/[...puckPath]/page.tsx`, so every scaffolded project froze a copy of it. Improvements to caching or datasource resolution could never reach a project once it was created. Both starter routes are now shims of under 25 lines.
  - What genuinely differs per app flows in as options: `Client` (which holds the app's `puck.config`), `Unavailable`, `Fallback` for a home page with no document yet, `fetchers`, `resolveMetadata`, and `titles`.
  - `internalPathPrefixes` is forwarded to `loadPublishedPage`, so the reserved-namespace denylist stays a single decision.
  - The home route now resolves CCR query datasources, which only the catch-all did before. A data-bound component on the home page previously rendered against an unresolved context.

  ### Migration / Action Required

  None — existing route files keep working. To adopt it, build the factory once in a shared module and re-export from both routes:

  ```tsx
  // app/published-pages.tsx
  export const published = createPublishedPage({
    Client,
    Unavailable: ContentUnavailable,
    Fallback: WelcomeBlock,
    fetchers: REMOTE_DATASOURCE_FETCHERS,
    resolveMetadata: resolvePageMetadata,
    titles: { home: 'My Site' },
  });

  // app/[...puckPath]/page.tsx
  export const revalidate = 300;
  export const generateStaticParams = published.generateStaticParams;
  export const generateMetadata = published.generateMetadata;
  export default published.Page;
  ```

  `revalidate` must stay a literal in the route file. Next.js statically analyzes segment-config exports, so a value re-exported through the factory goes undetected and the route silently loses its revalidation window — the same constraint that keeps `dynamic` in the route file for `createP1Pages`.

- 3e32a74: **[Fix]** `loadPublishedPage()` now refuses internal document namespaces itself, so `/_registry/**` and `/_redirects/**` 404 on a published site even when the app's `page.tsx` carries no denylist of its own.

  ### What Changed
  - The check used to live in the scaffolded catch-all route (`app/[...puckPath]/page.tsx`), duplicated across `generateMetadata` and the page body. That file is forkable user land: a project that rewrote or tidied it exposed every registry and redirect document as a live public page. Like the other invariants in `published-page.ts` — awaited init, miss-versus-outage, aborted prerender — this one belongs in the SDK.
  - Internal paths report `{ status: "missing" }` without reaching the backend, so the renderer's existing `notFound()` handling covers them with no extra code.
  - Matching is case-insensitive and on segment boundaries: `/_Redirects/x` is refused (the server lower-cases document paths before lookup, so it resolves the same record), while a real page at `/_registry-guide` still renders.
  - Scaffolded projects no longer ship `isInternalPath`. Existing projects keep working either way — a leftover local copy is now redundant, not harmful.

  ### Migration / Action Required

  None. To reserve additional namespaces of your own, pass them to `loadPublishedPage`:

  ```ts
  const result = await loadPublishedPage(path, {
    internalPathPrefixes: ['/_private'],
  });
  ```

  The option adds to the built-in list rather than replacing it, so a short list cannot un-block `/_registry`.

### Patch Changes

- b8bb111: **[Fix]** Opening the editor at a page that does not exist no longer does nothing.

  ### What Changed
  - The starter's editor POSTed to `/p1/api/structure/page` when a page was missing. No handler ever served that route, so the request 404'd and the failure was swallowed — navigating to a new editor path silently did nothing. The editor now shows a page-not-found panel in the canvas offering to create the page.
  - `p1-migrate` strips the dead call. An app that customized the region is left alone and reported, as with the codemod's other edits.

- Updated dependencies [3e80471]
- Updated dependencies [3bbdef5]
- Updated dependencies [b2a17ba]
- Updated dependencies [43f251c]
- Updated dependencies [b2a17ba]
- Updated dependencies [b8bb111]
  - @pantheon-systems/css-client@0.14.0
  - @pantheon-systems/puck-css@0.14.0

## 0.13.0

### Minor Changes

- d194eb4: **[Feature]** `brokerLogout()` is a new public export from `@pantheon-systems/css-client`. It asks the backend for the Auth0 logout URL and hands it back, reporting one of three outcomes — it does not navigate.

  **[Fix]** Broker logout now ends the Auth0 session. Previously it only cleared the local token, so the next login signed the same user straight back in without a prompt.

  ### What Changed
  - A failed logout no longer destroys the token, so it can be retried. The signed-in user's details are kept alongside it, rather than leaving a session that reports as authenticated with nobody attached.
  - `createBrokerAuth().logout()` performs the redirect for you and returns the same three outcomes. If you call it, you need do nothing.
  - `performLogout()` from `@pantheon-systems/puck-css` clears local state and returns the outcome, but does **not** redirect — on `signed_out` the caller must navigate to `outcome.logoutUrl`, or the Auth0 session stays alive.
  - `useP1Auth().logout()` does perform that navigation for you, and now returns the outcome instead of `void`; ignoring the return value still compiles.
  - Apps mounting `createP1AuthHandler` gain a `logout` route alongside `login` and `redeem`, so logout stays same-origin instead of calling the backend directly.
  - A logout URL that is not `https:` is now rejected as an error rather than navigated to.
  - `OAuthSession.logout()` returns the outcome instead of `void`. Calling it and ignoring the result is unchanged; writing your own `OAuthSession` implementation now means returning the outcome from `logout()`.

  ### Migration / Action Required

  Only if you call `brokerLogout()` directly. It returns instead of navigating, so the redirect is yours to perform — and on `signed_out` that navigation is what actually ends the Auth0 session:

  ```ts
  const outcome = await brokerLogout({ cssBaseUrl });

  switch (outcome.status) {
    case 'signed_out':
      // Required. Without this the Auth0 session survives and the next
      // login signs the same user back in with no prompt.
      window.location.href = outcome.logoutUrl;
      break;

    case 'no_session':
      break; // Nothing to sign out of.

    case 'error':
      // The token is kept deliberately. Show the message and let the user
      // retry — clearing local state here renders them signed out while
      // they still hold a live credential.
      showError(outcome.message);
      break;
  }
  ```

- 356af36: Move the editor's mid-switch waiting state out of the starter app and into the SDK.

  `useP1Editor` now keeps the last props that rendered, so a reload no longer blanks the canvas while the next document arrives, and it reports **why** it is reloading. New `<EditorReloadOverlay>` (backed by `LoadingOverlay` in `puck-css/pds`) renders the wait with the right copy: a workstream switch and a page switch were both announced as "Switching workstream" before, even though only one of them was.

  `useP1Editor` return shape:

  - `loading` now means _nothing to render yet_ — the first document has neither loaded nor failed. It no longer turns on for reloads that happen behind existing content. Callers using `loading` as "a switch is in flight" should read `reloading` instead.
  - `reloading: 'branch' | 'document' | null` — new.
  - `hasContent: boolean` — new; whether a document has ever loaded, i.e. whether `puckProps` are worth rendering.
  - `puckKey` / `puckProps` are retained across a reload rather than following the emptied context.

  The `p1-migrate` codemod adopts the SDK overlay as part of the migration, so a migrated app lands on the same editor page as a freshly scaffolded one. It leaves an app that customized that region alone.

  The reload reason is derived by comparing the branch the loaded document came from against the current branch, rather than latched when the branch changes. A workstream switch commits the branch and the navigation that goes with it in separate renders, so the load effect runs more than once per switch — a one-shot flag was consumed by the first run and every run after it reported a plain page switch.

### Patch Changes

- 61cb80e: **[Fix]** Public package builds no longer ship internal Jira ticket references, expanded internal service names, or backend implementation details (storage engine, compute primitive, real hostnames) in comments, JSDoc, `package.json` descriptions, or READMEs.

  ### What Changed
  - `css-client`, `p1-next-sdk`, `puck-css`, `p1-ai-chat`, and `p1-content-validator` now build in two `tsc` passes — one declarations-only, one comment-stripped `.js` — so implementation comments no longer survive into the published `.js`. JSDoc on exported symbols (which intentionally survives, for consumers' IDE tooltips) was hand-edited to drop internal ticket refs and backend rationale.
  - `p1-media`'s esbuild sourcemaps no longer inline `sourcesContent`; they previously shipped the entire original TypeScript source, comments included, regardless of any `.js`/`.d.ts` cleanup.
  - `puck-css`'s `files` allowlist no longer includes the bare `src/pds/theme` directory, which was shipping a raw test file and a 200KB generated `.ts` source file alongside the intended theme CSS (already covered by the existing `src/**/*.css` entry).
  - `create-p1-starter-kit`'s scaffolded template (copied from `apps/p1-starter`) had the same class of ticket-ref comments cleaned, including its example CI workflow.
  - Package `description` fields and `README.md` files (which npm always publishes regardless of the `files` field) no longer name the internal "CCR"/"Collaborative Content Repository" service.
  - `puck-css`'s `[ccr-store]` log tag and an internal Puck remount key are renamed (`[p1-store]` / `p1-<role>`); neither is persisted or part of any public contract.
  - A new CI guardrail (`.github/scripts/check-npm-leaks.sh`, wired into PR CI's hard gates and into `publish.yml`) packs each public package the way `npm publish` would and fails the build if any of these terms reappear. It fails closed — an unreadable tarball or a glob-free `files` entry whose build output is missing is an error, never a pass — and carries a `--self-test` mode, run first in both workflows, that verifies detection against fixtures.

  No public API or runtime behavior change.

  ### Deliberately out of scope
  - The bare `CCR` service name is deliberately still present in published output — most visibly `puck-css`'s exported `PRODUCTION_BASE_URL` (`https://ccr.p1.pantheon.io`, also referenced in `apps/p1-starter/.env.example`), the live default hostname every unconfigured consumer's SDK talks to, and ~200 local `ccr` variable bindings from `useP1Puck()`. Naming a service is not the leak this fix is about: the guardrail bans the architecture behind it — the expanded "Collaborative Content Repository"/"Collaborative State System" forms, storage engine, CRDT, compute primitive, ticket refs, and `.workers.dev` hostnames. Renaming those bindings is optional cleanup, not a release blocker.

- Updated dependencies [d194eb4]
- Updated dependencies [8916328]
- Updated dependencies [356af36]
- Updated dependencies [495856b]
- Updated dependencies [eb0d356]
- Updated dependencies [eb0d356]
- Updated dependencies [61cb80e]
- Updated dependencies [053ca52]
- Updated dependencies [f273c53]
- Updated dependencies [61cb80e]
  - @pantheon-systems/css-client@0.13.0
  - @pantheon-systems/puck-css@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [5c8b489]
- Updated dependencies [93f4976]
- Updated dependencies [b99acfb]
- Updated dependencies [b99acfb]
- Updated dependencies [716771a]
- Updated dependencies [c9e31fb]
  - @pantheon-systems/puck-css@0.12.0
  - @pantheon-systems/css-client@0.12.0

## 0.11.1

### Patch Changes

- a16d921: Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
  to `MIT` (or had no `license` field at all), but they are closed-source and were never
  intended to be published under an open-source license.
- Updated dependencies [a16d921]
- Updated dependencies [1297cd2]
  - @pantheon-systems/css-client@0.11.1
  - @pantheon-systems/puck-css@0.11.1

## 0.11.0

### Minor Changes

- f55ce53: **[Fix]** Published pages are now cached instead of server-rendered on every request.

  ### What Changed

  Both public routes shipped with `export const dynamic = "force-dynamic"`, which disables the response cache and forces a full server render — and a round trip to the content API — for every visitor, on content that is identical for all of them. The catch-all route additionally read `searchParams`, which opts a route out of caching permanently on its own.

  Published pages no longer read the request query string, and the catch-all declares `generateStaticParams`, so responses now carry `s-maxage=300, stale-while-revalidate` and are cacheable by a CDN.

  `loadRemoteDatasourceContext` now accepts `searchParams` as optional.

  **A path with no published page is now a real 404.** It previously rendered the "this page doesn't exist yet" screen with a 200 status, which was harmless while every response was uncacheable. Now that the route is statically renderable, a 200 there means every URL a crawler probes becomes a cached response and an indexable page. The screen itself is unchanged — it moved to `app/not-found.tsx`, so it renders from the not-found boundary with a 404 status. A backend outage is deliberately _not_ a 404: it renders a separate, uncacheable holding page, because 404ing live content over a transient blip would deindex it.

  **Reads of published content moved into `@pantheon-systems/p1-next-sdk/server`** as `loadPublishedPage` and `loadRouteTemplateKeys`. They carry invariants that are easy to break by accident in a forked app — initialization awaited per read, misses distinguished from outages, prerendering aborted rather than baking an empty page into the build, and both reads memoized with React `cache()` so `generateMetadata` and the page body share one fetch instead of hitting Postgres twice. How a miss is _presented_ stays in the app.

  Initialization is likewise no longer pinned to a module-level promise in `createP1Handler` and `createP1Pages`. `ensureInitialized` clears its state on failure precisely so the next caller retries; awaiting a stored promise defeated that, so one transient failure at cold start left every later request awaiting a permanently rejected promise.

  **Publishing a route template now invalidates the public catch-all segment.** Instance URLs that resolve by template fall-through alone (`/jedi/5` against `/jedi/:id`) have no store entry, so they cannot be enumerated and were never revalidated — they served pre-edit content until `revalidate` expired. `createP1Handler` accepts `publicPageSegment` for an app whose catch-all is not `[...puckPath]`.

  ### Caching and publish visibility

  `revalidatePath` clears the Next.js response cache, so with no CDN in front an edit appears immediately — that invalidation was previously dead code, since there was never a cached response to invalidate. Behind a CDN that honors the advertised `s-maxage=300`, a publish takes up to 300s (plus `stale-while-revalidate`) to become visible, because nothing in this flow purges the CDN. Adding a purge hook to the publish path is what would close that window.

  ### Migration / Action Required

  The `?param=` **query override** no longer applies to published pages. Route template params are unaffected — they come from the path, so `/products/hats` still resolves `{{ urlParams.slug }}` as before. Only overriding that value with `?slug=…` stops working, along with any datasource driven purely by a query param.

  Editor preview is unaffected; it resolves params through the editor's own saved preview values.

  If a page genuinely needs query-driven content, read the query in a client component with `useSearchParams` — the page stays cached and only that subtree renders per request.

  A custom renderer that calls `getPage` directly should switch to `loadPublishedPage` from `@pantheon-systems/p1-next-sdk/server` and branch on its `status`, rather than treating a `null` return as both "missing" and "backend down".

### Patch Changes

- 77ba737: **[Fix]** Requests for static assets no longer reach the document API.

  ### What Changed
  - Paths ending in a known static-asset extension (`.js`, `.css`, `.png`, `.webp`, `.svg`, fonts, media, and friends) return `null` from `getPage` without a document lookup. Previously each of these 404s cost a content-API round trip and live Postgres work.
  - `normalizePath` now rejects those paths too, so a page can no longer be published at a path the renderer refuses to resolve.
  - `hasStaticAssetExtension` is exported from `@pantheon-systems/puck-css` and `/server`.

  ### Notes
  - Page slugs may legitimately contain dots, so the check matches an explicit extension list rather than treating any dot as an extension. `/v1.2-release-notes` still resolves.
  - `.html`, `.php`, `.aspx`, and `.pdf` are deliberately **not** short-circuited — sites migrating off a legacy CMS serve real pages at those paths.
  - Redirect lookups are unaffected: redirects are user-configured for arbitrary paths, including old asset URLs that a migrating site points at a new home, so the middleware still resolves them for asset-extension paths.

- Updated dependencies [a5880d4]
- Updated dependencies [863bff6]
- Updated dependencies [f55ce53]
- Updated dependencies [77ba737]
  - @pantheon-systems/puck-css@0.11.0
  - @pantheon-systems/css-client@0.11.0

## 0.10.0

### Minor Changes

- e8a472a: Adds the DataListBlock ("List") view-system component: a datasource-driven Puck block that renders a collection in three modes — Grid (cards), Table (rows), and List (listing). Modes come from a registry (`builtin-modes.ts`) mapping each mode key to its layout component, image positions, mode-specific fields, and defaults, so a new mode can be added without touching the block itself. `createDataListBlock()` is exported for apps to instantiate with their own wrapper class.

  When a datasource is selected but field mappings are empty, `autoMapFields()` heuristically assigns datasource fields to the title, subtitle, teaser, image, and icon roles by name pattern, so a freshly dropped block renders real content instead of blanks.

  Adds collection operators (sort, filter, group-by, start-at, max-items, and conditional status filtering for CMS template datasources), applied in the block's `resolveData`.

  Sidebar fields are grouped into collapsible "Content" and "Layout & style" sections via `DataListFieldsGrouper`, which also hides fields belonging to inactive view modes. Puck's built-in field types are replaced throughout with PDS field wrappers (datasource-select, schema-select, template-select, view-mode, image-position) for consistent styling.

  `css-client` gains the query fields and types the block needs to read collection content; `p1-next-sdk` middleware and query fetchers pass them through. The starter-kit template build script now carries the new block's files.

### Patch Changes

- 74dda98: Adds a README to every published package. Each one rendered a blank page on npmjs.com, because
  no `README.md` existed in the package directory to be included in the tarball — npm renders the
  README from the published tarball, not from the source repository, so a private repo was never
  the cause.

  Also repoints every `repository` URL at `pantheon-systems/p1-platform` with the correct
  `directory`. They still referenced the pre-merge repositories (`puck-css-integration`,
  `collaborative-state-system`, `p1-media-r2`), so the "Repository" link on each npm page went
  nowhere. Adds a matching `homepage` for each package.

  No runtime code changes.

- e8a472a: Fixes template datasources, which could not resolve end to end. Three separate faults sat on the same path: `getEditorContext` ran outside the request auth context, so lazy branch resolution never completed and both the template datasource list and the route list came back empty; `extractReferencedDatasourceIds` and `resolveSourcePath` both used `\w`, which excludes the hyphen, so the kebab-case query names behind every `templates.<name>` id failed to match a fetcher and were then read as subtraction by the expression evaluator.

  A failed CSS query lookup in the editor context now warns instead of being swallowed, so an empty datasource dropdown is diagnosable.

- Updated dependencies [d44e904]
- Updated dependencies [e8a472a]
- Updated dependencies [03c3ab3]
- Updated dependencies [89fd945]
- Updated dependencies [e8a472a]
- Updated dependencies [f9d18df]
- Updated dependencies [74dda98]
- Updated dependencies [db21361]
- Updated dependencies [e8a472a]
  - @pantheon-systems/css-client@0.10.0
  - @pantheon-systems/puck-css@0.10.0

## 0.9.0

### Minor Changes

- cbaa45c: **css-client:** Add Datasource and Query API endpoints. `DatasourcesEndpoint` provides `list`, `get`, and `delete` for content type datasources. `QueriesEndpoint` provides `list`, `get`, `delete`, and `getResults` with pagination support. New types exported: `Datasource`, `Query`, `QueryResults`, `QueryResultItem`, `QueryResultsMeta`, `QuerySortField`, and `QueryResultsParams`.

  **p1-next-sdk:** Integrate CSS query fetchers into server-side rendering. `createCssQueryFetchers` converts CSS queries into `RemoteDatasourceFetcher` instances for SSR data pre-fetching. Query fetchers are wired into the `datasource-context` and `editor-context` routes. Gracefully handles environments where the queries endpoint is unavailable.

  **puck-css:** Add `cssQueriesToDatasourceDefinitions` adapter to transform CSS query metadata into `RemoteDatasourceDefinition` entries for the editor datasource registry. Fix `mergeBlockForPreview` and `mergeRootForPreview` to preserve React element props (e.g. contentEditable spans) instead of overwriting them with resolved string values. Fix template overlay text visibility and caret rendering. Pass auth tokens to editor-context and datasource-context fetch calls when available.

### Patch Changes

- be8bf28: **puck-css:** The right-hand inspector supports **collapsible field sections** and
  **per-field help text**, both opt-in through Puck's per-field `metadata` so existing
  configs render unchanged.

  Help text is declared as `metadata: { help, helpWhenEmpty }` and renders beneath the input.
  `help` always shows; `helpWhenEmpty` shows only while the field has no value, which is how
  an inheriting field can say where its value is coming from — a field inherits exactly while
  it's empty. Fields declaring neither key are untouched.

  `PRODUCTION_BASE_URL` is now re-exported from `@pantheon-systems/puck-css/server`, so apps
  and SDKs can resolve the default backend without reaching into internals.

  **p1-next-sdk:** Broker login no longer fails when no backend URL is configured. An unset
  `p1BaseUrl` (neither `CSS_BASE_URL` nor `NEXT_PUBLIC_CSS_BASE_URL` set) now falls back to
  the production backend for both the login and redeem calls, matching what
  `createNextConfig` and `createNextContentClient` already did. Previously an unset value was
  passed straight through and the login round-trip failed.

- f815649: Fix the post-login redirect landing on `localhost:3000` instead of the site's real public URL. `postBrokerLogin` derived its redirect origin from the Route Handler's `request.url`, which reflects the Node server's own bind address once a reverse proxy is involved rather than the Host the browser actually requested. It now reads the `host` header instead, with `P1_SITE_URL`/`p1SiteUrl` still taking priority when set.

  `x-forwarded-host` is deliberately not consulted: on Pantheon it is not validated the way `Host` is (an arbitrary `Host` is rejected upstream; an arbitrary `X-Forwarded-Host` is not), so trusting it here would let a request redirect a login to an attacker-controlled origin. (PCC-3574)

  Also, from the same review: a malformed `P1_SITE_URL`/`p1SiteUrl` no longer throws and 500s the login route -- it falls back to the request's own origin and logs a warning instead.

- 78b00e2: Complete the SDK half of removing the per-environment `P1_SITE_URL` requirement (PCC-3531 phase 3). A multidev inherits its site's `P1_SITE_URL` at provisioning time, which points at the wrong environment with no error -- that cannot be fixed operationally, only by no longer depending on it.

  The browser has always known its own origin; it just never said so. `css-client`'s `login()` now states it -- `{ origin }` in proxy mode, `{ proposedRedirectUrl }` in direct mode, since direct mode has no server hop to compose the URL -- and `p1-next-sdk`'s `postBrokerLogin` forwards it upstream as `proposedRedirectUrl`, but only when neither `P1_SITE_URL`/`p1SiteUrl` nor an explicit `redirectUrl` is configured: a configured site's request is byte-identical to before this existed. Neither layer makes a trust decision -- CCR is the only party that authenticates the site, so it is the only place the proposal is checked against the site's registered origins (already live; this was the unused half).

  Also fixes a disclosure this same mechanism created: `/p1/auth/login` is a public, unauthenticated endpoint, and CCR's decline-warning was being returned straight through in the response body, letting a caller probe whether a given origin is registered for a site by watching the warning appear or vanish. The warning is now logged server-side with a `[P1AuthHandler]` prefix and stripped before the response reaches the browser.

- Updated dependencies [0077a4b]
- Updated dependencies [be8bf28]
- Updated dependencies [be8bf28]
- Updated dependencies [d04d399]
- Updated dependencies [cbaa45c]
- Updated dependencies [be8bf28]
- Updated dependencies [be8bf28]
- Updated dependencies [be8bf28]
- Updated dependencies [83567a7]
- Updated dependencies [be8bf28]
- Updated dependencies [78b00e2]
- Updated dependencies [7d51095]
- Updated dependencies [be8bf28]
  - @pantheon-systems/puck-css@0.9.0
  - @pantheon-systems/css-client@0.9.0

## 0.8.0

### Minor Changes

- 3ed945e: The P1 editor now renders from a persistent `Layout` instead of the catch-all `Page`, so navigating between documents no longer remounts the whole editor (providers, auth, and the Puck canvas iframe). `createP1Pages()` returns a `Layout` that renders the editor, `Page` is intentionally empty, and `EditorClient` is rendered with no props — it derives the edited page from the URL via the new `editorPagePathFromUrlPath` export.

  This is a breaking change for existing apps: the editor must be mounted from an `(editor)` route group. If you upgrade but keep only the old `app/p1/[[...p1]]/page.tsx`, the editor renders blank (TypeScript apps get a compile error from the changed `EditorClient` prop type; JavaScript apps get no signal, plus a one-time dev warning). New scaffolds from `create-p1-starter-kit` are unaffected.

  To migrate an existing app, run the codemod shipped with this release:

  ```bash
  npx @pantheon-systems/p1-next-sdk p1-migrate
  ```

  It restructures the routes for you (clean-tree gated, `--dry-run` supported, idempotent) and bails to the manual guide if your files diverged from the starter shape. See `docs/MIGRATION-EDITOR-LAYOUT.md` for the full guide and manual steps.

### Patch Changes

- `@pantheon-systems/css-client` and `@pantheon-systems/puck-css` are no longer declared as `peerDependencies`; they remain regular `dependencies`. The four suite packages are a lockstep group that always publishes at one version, so the peer edge duplicated a guarantee lockstep already provides — and caused every non-patch release to escalate the whole suite to a major bump. `peerDependencies` is now external-only (`react`, `react-dom`, `next`, `@puckeditor/core`). Consumers should continue to pin all suite packages at the same version.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @pantheon-systems/puck-css@0.8.0
  - @pantheon-systems/css-client@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [b0254ff]
- Updated dependencies
- Updated dependencies [e937842]
- Updated dependencies [e937842]
  - @pantheon-systems/puck-css@0.7.0
  - @pantheon-systems/css-client@0.7.0

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
