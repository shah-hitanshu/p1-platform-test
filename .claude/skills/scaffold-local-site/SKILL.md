---
name: scaffold-local-site
description: Use when standing up a throwaway P1 starter site from this working tree rather than from npm — "scaffold a site from the local repo", "generate a starter kit from the tarball", "test my template change in a real app", or reproducing a scaffold CI failure locally. Produces a site whose template and @pantheon-systems dependencies are the code in this checkout.
---

# Scaffolding a site from this working tree

`pnpm dlx @pantheon-systems/create-p1-starter-kit` scaffolds from **npm** — published template,
published packages. It cannot show you unreleased work. Scaffolding from the checkout means packing
the kit and the packages it depends on, and making the new site install those tarballs.

## Do this

```bash
pnpm install   # repo root, first — a stale install is Gotcha 1
pnpm --filter @pantheon-systems/css-client \
     --filter @pantheon-systems/puck-css \
     --filter @pantheon-systems/p1-next-sdk \
     --filter @pantheon-systems/p1-ai-chat \
     --filter @pantheon-systems/p1-media build

cd packages/create-p1-starter-kit
pnpm scaffold:local ~/pantheon/assorted-repos/<site-name>
```

`scripts/scaffold-local.js` builds and lints the template, runs the CLI, packs the five workspace
packages into `<site>/local-tarballs`, wires them up as pnpm `overrides`, installs, asserts the
overrides were actually honoured, then runs `typecheck` / `test` / `build` in the new site. It
refuses rather than clobbers an existing directory.

Options: `--published` (install the released packages — for a template-only change) · `--pm
<pnpm|npm|yarn>` · `--no-verify` · `--force`.

CI runs the same steps through `scripts/validate-scaffold.js`, into a temp dir it deletes on
success; both share `scripts/lib/packed-overrides.js`.

## Then hand it over

The site needs `.env.local` — site ID, API key, `NEXT_PUBLIC_CSS_BASE_URL`,
`NEXT_PUBLIC_P1_ADMIN_DASHBOARD_URL`, `NEXT_PUBLIC_MEDIA_BASE_URL` — before `pnpm dev` renders
content. Say plainly that the site is unconfigured until then; don't imply a working site.

## Which dependencies

Default to the packed tarballs. The template tracks `apps/p1-starter`, which routinely imports
package subpaths that aren't published yet, so `--published` can fail `typecheck` with
`Cannot find module '@pantheon-systems/puck-css/<subpath>'`. That error is dependency skew — a
correct scaffold reporting that the template is ahead of the registry, not a broken one.

## Gotchas

The script guards 1, 3 and 4; they are here because they also bite when a step is run by hand, and
because a guard firing needs to be read as a diagnosis rather than a bug in the tooling.

1. **A package build can emit `.d.ts` and zero `.js`.** The two-pass `tsc` build runs declarations
   first; when the emit pass fails — most often an import the current `node_modules` doesn't have —
   the build still exits 0 and `dist/` looks populated. The tarball then installs fine, type-checks
   fine against the `.d.ts`, and every subpath import throws `Cannot find package` at runtime. The
   fix is almost always `pnpm install` at the repo root, then rebuild.
2. **The extracted kit cannot be `npm install`ed.** `pnpm pack` rewrites the workspace devDependency
   `@pantheon-systems/eslint-config` to a concrete version that was never published, so npm 404s
   even under `--omit=dev`. Running the CLI by hand out of an unpacked tarball needs only
   `@clack/prompts` and `picocolors` — symlink the repo package's `node_modules` in.
3. **pnpm ignores `pnpm-workspace.yaml` edits.** After adding `overrides:`, `pnpm install` prints
   "Already up to date" and does nothing — with `--force`, and with the lockfile deleted.
   `--reporter=ndjson` shows why: "No manifest files were modified since the last validation." pnpm
   caches `node_modules/.pnpm-workspace-state.json` and validates package.json mtimes only. Delete
   that file and touch `package.json`.
4. **An ignored override fails silently and looks like success.** The install, the build, and most
   tests pass against the published packages. `grep -c local-tarballs pnpm-lock.yaml` is the proof;
   zero means npm won.
5. **Repacking keeps the filename and version.** After rebuilding a package and repacking, check the
   file you expected actually changed in the site's `node_modules` rather than assuming the
   reinstall picked it up.
