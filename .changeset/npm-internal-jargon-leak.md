---
"@pantheon-systems/css-client": patch
"@pantheon-systems/p1-next-sdk": patch
"@pantheon-systems/puck-css": patch
"@pantheon-systems/p1-ai-chat": patch
"@pantheon-systems/p1-content-validator": patch
"@pantheon-systems/p1-media": patch
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** Public package builds no longer ship internal Jira ticket references, expanded internal service names, or backend implementation details (storage engine, compute primitive, real hostnames) in comments, JSDoc, `package.json` descriptions, or READMEs.

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
