# apps/p1-starter

The sample app **and** the scaffold source. `packages/create-p1-starter-kit/scripts/build-template.js`
copies this directory wholesale into that package's `template/`, so every file here
ships to customers on npm — see the root `CLAUDE.md` for what that means for
comments, JSDoc and READMEs.

Commands: `pnpm dev | build | test | lint | typecheck`, `pnpm sync:registry`.

## A customer forks this and leaves

Scaffolding is a one-way copy. A customer runs `create-p1-starter-kit`, gets these
files as their own source, and edits them. Nothing you change here afterwards ever
reaches that project. There is no update channel for template code — only for the
packages it imports.

So the question for every change is **"must this be fixable after scaffolding?"**

- **Yes** → it belongs in `@pantheon-systems/p1-next-sdk`, `@pantheon-systems/puck-css`
  or `@pantheon-systems/css-client`, and the file here becomes a thin shim that passes
  app-specific values in. A caret-ranged dependency is the only thing that can carry a
  fix into a project that already exists.
- **No** → it belongs here. Branding, copy, demo content, example datasources, the
  `puck.config.tsx` block selection: things a fork is *supposed* to rewrite, where a
  frozen copy is the feature.

Anything an incorrect fork breaks is a **yes**, regardless of how app-shaped it looks:

- **Invariants** — a security or protocol rule enforced in template code is enforced
  only until someone rewrites the file around it. PCC-3686 moved the
  `/_registry` / `/_redirects` denylist into `loadPublishedPage()` for exactly this
  reason; the route can no longer opt out, and an added `internalPathPrefixes` extends
  the built-in list rather than replacing it, so no caller can shorten it.
- **Logic coupled to a shape a package owns** — the SEO layer read `root.props._seo`
  and `root.props._meta`, which `puck-css` defines. Every scaffold froze its own
  reader, so changing the stored shape would have silently mishandled it everywhere.
  PCC-3688 split it by ownership: resolution to the SDK, field definitions to
  `puck-css/seo`.
- **Pipelines we expect to keep improving** — PCC-3687 put the published-page render
  path behind `createPublishedPage()` so caching and datasource work reaches existing
  projects. Both routes are ~20-line shims. When a literal genuinely cannot move
  (`revalidate` must be statically analyzable in the route), leave it with a comment
  saying why, so the next person doesn't "finish" the move.

A shim that reads as boilerplate is the goal, not a smell.

## Breaking an existing scaffold

Preferred order:

1. **Make it not breaking.** Land the change behind a package boundary so a scaffold
   picks it up on `npm update` and edits nothing.
2. **Breaking but self-announcing.** A type-level break plus a changeset and a
   `docs/MIGRATION-*.md` is the floor. A dev-only runtime warning that detects the old
   shape is a good addition; treat it as a nudge, not a guarantee.
3. **A codemod, only when it earns it.** `p1-next-sdk migrate`
   (`packages/p1-next-sdk/bin/lib/cli.js`) exists because SDK 0.8 moved the editor
   into an `(editor)` route group — upgraded apps got a silently empty editor. Ship
   one when the edit is localized, mechanical, and hard to hand-roll correctly. Do
   not ship one to save a customer work they can do safely themselves.

If you do write one, that codemod's conventions are not stylistic — each came from a
real failure:

- **Template-match or bail.** Validate every target before touching it and refuse on
  drift. Do not fuzzily rewrite; point at the guide instead.
- **Enumerate before you delete.** The first version read two known files out of the
  old catch-all and then `rmSync`-ed the directory, taking any `loading.tsx`,
  co-located component or CSS module with it and exiting 0. Never delete a directory
  you have not fully accounted for.
- **Bail on extra route-special files rather than moving them.** Next scopes
  `error.tsx` / `loading.tsx` / `layout.tsx` by position. Moving one faithfully into
  the new segment puts it *below* the editor layout, where its boundary silently stops
  catching what it used to. Moving it correctly still breaks it. The split that works:
  the codemod does the error-prone parts, the user moves their own folders.
- **No install-time hooks.** postinstall runs in CI and on every install, and pnpm 10+
  won't run dependency lifecycle scripts unless allowlisted. Auto-detect, then apply
  on one explicit command.
- **Unknown flags are a hard error.** `--dryrun` silently ran the real migration, and
  `--dir /path` (space, not `=`) silently migrated the cwd.
- **Fixtures, never a moving git ref.** The proof test read the old layout via
  `git show main:…`; `actions/checkout` is shallow by default so `main` doesn't exist
  in CI, and `git show 'main:path/with/[[...brackets]]'` *exits 0* — git falls back to
  treating the argument as a pathspec and prints a commit header. It bailed on a commit
  header while passing locally. Vendor the legacy sources under `src/__tests__/fixtures/`.

Versioning: the packages are pre-1.0 in a `fixed` changeset group, so a breaking
change ships as a **minor**, not a major. Caret ranges don't auto-jump a minor, so a
routine `npm install` doesn't break anyone.

## Template mechanics

- `packages/create-p1-starter-kit/template/` is **gitignored and generated**. Never
  edit it. Change files here, then `npm run build` in the scaffolder and check what
  came out.
- `build-template.js` copies everything except `SKIP_PATTERNS`. Adding a
  monorepo-only file here means adding a skip rule there — and, for anything the app
  always has, adding it to `RULES_THAT_MUST_MATCH` so a later rename fails the build
  instead of quietly shipping the file. A monorepo README and a 466KB `.tsbuildinfo`
  reached customers before that check existed.
- **The README customers get is `packages/create-p1-starter-kit/template-assets/README.md`,
  not this one.** `README.md` is on the skip list — the one here describes the sample app
  inside this monorepo — and `template-assets/` is overlaid on top of the copy afterwards.
  So documenting a starter change for customers means editing *that* file; editing this
  one changes nothing they ever see. Both are easy to forget, and only one of them ships.
  `PLACEHOLDER_PROJECT_NAME` in it is substituted with the real project name at scaffold
  time, so keep the token intact.
- `template-assets/` is the home for anything else authored *for* the scaffold rather
  than copied into it — a customer-facing agent guide would go there too.
- `scripts/lint-template.js` fails on monorepo paths, `workspace:` specifiers and
  imports of packages the template's manifest doesn't declare.

## Tests ship too

The suite here runs twice: in the monorepo against workspace source, and inside
`create-p1-starter-kit` against the **published** packages a real scaffold installs.
The second environment has different dependencies — `cpub-react-sdk` is a starter dep
but not a scaffolder one, so a test that transitively imports it fails there and only
there. Mock at the boundary the file under test actually imports (a wiring test for a
route shim has no business loading the datasource or SEO stacks), and avoid aliases
that reach into a package's internals — `puck-css` publishes the entry points these
tests need.

`readme-accuracy.test.ts` is withheld from the template by name; that's the exception,
not the pattern.

## Gotchas

- **`next dev` takes a directory-level lock, not just a port.** A dev server already
  running on another port makes the Playwright config fail with "Another next dev
  server is already running."
- **A `"use client"` barrel poisons plain re-exports.** `puck.config.tsx` is imported
  by `app/p1/api/[...p1]/route.ts`, so the root config is evaluated on the server.
  Re-exporting a server-safe helper through `puck-css/fields` makes it a client
  reference and fails `next build` — unit tests and `tsc` both pass. Only the full
  `pnpm build` catches it.
- **Workspace deps resolve to `dist`.** A new package export is invisible here until
  that package is rebuilt, and the failure looks like a logic bug (an `undefined`
  constant) rather than a stale build.
