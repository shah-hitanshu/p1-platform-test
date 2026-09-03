# Releasing npm packages

Seven packages under `packages/*` publish to npm under `@pantheon-systems`, through
[Changesets](https://github.com/changesets/changesets) and three jobs:

| Workflow                                                          | Trigger         | Job       | What it does                                                          |
| ----------------------------------------------------------------- | --------------- | --------- | ---------------------------------------------------------------------- |
| [version-packages.yml](../.github/workflows/version-packages.yml) | push to `main`  | `version` | opens/updates the "Version Packages" PR. Publishes nothing.           |
| [publish.yml](../.github/workflows/publish.yml)                   | manual          | `publish` | releases to npm under `latest`, tags, cuts GitHub Releases.           |
| [publish.yml](../.github/workflows/publish.yml)                   | manual          | `canary`  | publishes a snapshot of `main` under `canary`. No tags, no releases.  |

There is no manual `npm publish` path — publishing authenticates via GitHub OIDC from
`publish.yml`, so anything on npm originated from `main`.

`packages/eslint-config` is `private: true` — it is workspace-internal and never published.

## The flow

**1. Author a changeset in the PR that makes the change.**

```bash
pnpm changeset
```

Pick the affected package(s) from the checklist, choose patch/minor/major for each, and
write a summary. One changeset can cover several packages at different bump levels — see
[.changeset/datasource-query-api.md](../.changeset/datasource-query-api.md). The generated
markdown file gets committed with your code. Its summary becomes the CHANGELOG entry and
the GitHub Release body, so write it for a consumer of the package, not for a reviewer of
the diff.

**2. Merge to `main`.** **Version Packages** opens (or updates) a **"Version Packages"** PR
that applies every pending changeset: version bumps, CHANGELOG entries, and
deletion of the consumed changeset files. It accumulates — merging three feature PRs gives
you one Version PR covering all three. Nothing publishes here, and a push carrying no
changeset does nothing at all.

**3. Merge the Version Packages PR.** The new versions and CHANGELOGs land on `main`. Still
nothing is published.

**4. Run the workflow to publish.** Actions → **Publish to npm** → _Run workflow_. This is
the deliberate step: publishing is never a side effect of a merge. It's gated on the
`npm-release` environment, and it runs `changeset publish`, which:

- publishes each package whose version isn't yet on npm,
- pushes one git tag per package — `@pantheon-systems/puck-css@0.9.0`, not a repo-wide
  `v0.9.0`,
- creates **one GitHub Release per package**, with that package's CHANGELOG section as the
  body. Three packages published in one run means three separate releases, one per
  independently consumable thing.

Only packages that actually changed are published. There is no "release everything" step.

It fails fast if any changesets are still pending, because `changesets/action` takes the
version-PR path whenever it finds one — so publishing before step 3 would silently open a PR
instead of releasing. Merge the Version PR first.

### Why versioning and publishing are separate workflows

Publishing on a `workflow_dispatch` rather than on the Version PR merge means a release is
always an explicit act. Keeping it out of `version-packages.yml` means `id-token: write` —
the credential that can publish to npm — never exists on a push to `main`. Changesets
recommends separating version from publish for exactly that reason.

Canary is the one thing that shares `publish.yml`, and only because npm trusted publishing
keys on the workflow filename. See [Canary builds](#canary-builds).

## Can I release one package on its own?

Yes, for three of the seven. Only the Puck SDK four are coupled:

| Package                                                          | Releases alone?                     |
| ---------------------------------------------------------------- | ----------------------------------- |
| `p1-ai-chat`                                                     | yes                                 |
| `p1-content-validator`                                           | yes                                 |
| `p1-media`                                                       | yes                                 |
| `css-client`, `puck-css`, `p1-next-sdk`, `create-p1-starter-kit` | no — fixed group, all four together |

So a chatbot-only release is a single changeset naming `@pantheon-systems/p1-ai-chat`,
and nothing else moves:

```
$ pnpm changeset status --verbose
info Packages to be bumped at patch
- @pantheon-systems/p1-ai-chat 0.3.1
info Running release would release NO packages as a minor
info Running release would release NO packages as a major
```

Nothing in the repo depends on `p1-ai-chat`, so it has no dependents to drag along. The
reverse direction — a puck-css release pulling `p1-ai-chat` in — is what the peer-dependent
fix below prevents.

## Things that constrain which packages you can release

**The Puck SDK packages are a fixed group.** `css-client`, `puck-css`, `p1-next-sdk`, and
`create-p1-starter-kit` share a version (`fixed` in [.changeset/config.json](../.changeset/config.json)).
A changeset naming any one of them bumps and publishes all four to the same version. They
ship as a single SDK surface, so this is intended — but it means "just release puck-css"
isn't a thing. `p1-ai-chat`, `p1-content-validator`, and `p1-media` release independently.

**Peer dependents no longer bump automatically.** `p1-ai-chat` and `p1-media` peer-depend
on `@pantheon-systems/puck-css` at open-ended ranges (`>=0.4.0`). Changesets' default
behavior is to give any peer dependent a _major_ bump whenever the peer is bumped, which
would have shipped surprise `1.0.0` releases of both packages on every puck-css minor. The
config sets `onlyUpdatePeerDependentsWhenOutOfRange: true`, so they now bump only when a
new puck-css version falls outside their declared range. If you widen or tighten a peer
range deliberately, write the changeset for it yourself.

This cascade bit the suite twice before the merge — the 0.7.0 release needed its generated
versions hand-corrected down from `1.0.0`, and the source repo's fix was to drop the peer
deps from `p1-next-sdk` outright. `p1-ai-chat` and `p1-media` genuinely are puck-css
plugins, so the range stays and the config flag carries the fix instead. Background and the
remaining dependency-topology cleanup:
[docs/puck/package-versioning-and-dependency-topology.md](puck/package-versioning-and-dependency-topology.md).

**Private packages are skipped entirely.** `privatePackages: { version: false, tag: false }`
keeps the apps and workers (`apps/p1-starter`, `workers/*`) out of versioning — they deploy
via **Deploy Workers**, and their `package.json` versions are meaningless.

## Dry runs and pre-flight checks

There's no true end-to-end rehearsal — OIDC publishing can't be simulated, and npm has no
reusable dry-run for a trusted-publisher exchange. But every failure mode short of the npm
handshake is checkable locally.

**What will be released, and why:**

```bash
pnpm changeset status --verbose
```

Lists each package to be bumped, its resulting version, and the changeset files
responsible. Run this before merging a Version PR. A package appearing here with no
changeset file listed under it is a dependency- or peer-driven bump — worth understanding
before it ships.

**What the Version PR will look like**, without committing it:

```bash
pnpm changeset version && git diff
```

Then `git checkout . && git clean -fd .changeset` to undo. Useful for eyeballing CHANGELOG
wording and confirming internal dependency ranges update the way you expect.

**What actually lands in the tarball** — the most valuable check, since `files` mistakes
are the usual cause of a broken release:

```bash
pnpm --filter @pantheon-systems/puck-css build
pnpm --filter @pantheon-systems/puck-css exec npm pack --dry-run
```

Confirm the built `dist/` (and for `puck-css`, its CSS and `src/pds/theme`) are present and
that nothing secret or oversized is. `create-p1-starter-kit` is the one to watch — it ships
`template/`, not a `dist/`.

**The closest thing to a full rehearsal** — bump versions locally, then dry-run the
publish to see the exact set that would go out:

```bash
pnpm changeset version
pnpm publish -r --dry-run --no-git-checks
git checkout -- packages && git checkout -- .changeset
```

This prints one line per package that would publish and runs each package's
`prepublishOnly`, so it catches build failures in the release path specifically. It's worth
doing before the first release of a group: it's how you'd notice, for example, that
`create-p1-starter-kit`'s template build rewrites its `workspace:*` deps to the new
`^0.9.0` at publish time rather than at the workflow's earlier build step.

Run it in this order — on its own, `pnpm publish -r --dry-run` reports "no new packages
that should be published", because every current version is already on the registry. It
only shows you anything after the version bump.

## Canary builds

All seven publishable packages can go out together under the `canary` dist-tag, built from
whatever is on `main` at the time. Actions → **Publish to npm** → _Run workflow_ → tick
**Publish a canary snapshot instead of a release**.

```bash
pnpm add @pantheon-systems/puck-css@canary
pnpm create @pantheon-systems/p1-starter-kit@canary
```

`latest` never moves. A canary version looks like `0.14.0-canary-20260903050112`, and npm
excludes prereleases from a range unless the range names the same `major.minor.patch` — so
nothing resolving `^0.13.0` will ever pick one up. Opting in means naming the tag or pinning
the exact version.

Canaries are not releases and are not supported. There is no CHANGELOG entry, no git tag,
and no GitHub Release; the version's timestamp is the only record of what went into one.

### How it differs from the release path

The `canary` job runs `changeset version --snapshot canary`, then publishes with
`--tag canary --no-git-tag`. Nothing is committed — the version bumps, CHANGELOG edits, and
consumed changeset files live and die in the runner's checkout. Pending changesets are read
along the way, so a canary reflects the bumps queued for the next release
(`snapshot.useCalculatedVersion` in [.changeset/config.json](../.changeset/config.json) is
what makes `0.14.0-canary-…` rather than the default `0.0.0-canary-…`).

Two things the release path gets for free need doing explicitly here:

**Every package is named, every run.** `changeset version --snapshot` only bumps packages
that have a pending changeset, so packages with nothing queued would keep their last stable
version and publish nothing. [scripts/write-canary-changeset.ts](../scripts/write-canary-changeset.ts)
writes one throwaway changeset naming all seven, so `canary` means "main, as of this run"
for every package.

**Scaffold dependencies pin exactly.** `create-p1-starter-kit` normally rewrites its
`workspace:*` deps to a caret range so a scaffold picks up patches. Under a prerelease
version that range would resolve to a stable release above it, and a canary scaffold would
install stable SDK packages next to the canary kit that generated it. `toPublishedRange`
in [workspace-deps.js](../packages/create-p1-starter-kit/scripts/workspace-deps.js) emits an
exact version whenever the workspace version is a prerelease.


## First release from this repo

Two things to set up before the first publish:

**npm trusted-publisher entries.** All 7 published packages need their npmjs.com settings to
trust repo `pantheon-systems/p1-platform` + workflow `publish.yml` — add these _before_
removing the old repos' entries. Until then the workflow runs fine up to the publish step
and then fails the OIDC exchange. While you're in there, disallow tokens for these packages:
the workflow has no token path at all, so requiring OIDC costs nothing.

Do **not** give the publishers stage-only permissions. npm's staged publishing is a good
idea in principle, but `changeset publish` can't stage
([changesets#2025](https://github.com/changesets/changesets/issues/2025) is open and
unimplemented), so stage-only permissions would reject every CI publish. Revisit when
changesets supports it. The `npm-release` environment approval below is the gate we have in
the meantime.

**Required reviewers on the `npm-release` environment.** The `publish` job declares it, but
GitHub creates a missing environment implicitly with no protection rules — so until
reviewers are added the gate silently does nothing and a dispatch publishes immediately.

Two consequences of the org rulesets on `main`, both already handled or benign:

- **Signed commits are required.** The workflow uses `commitMode: github-api` so the
  "Version Packages" commit is GPG-signed by GitHub. Without it, branch protection rejects
  the push.
- **CI does not run on the Version Packages PR.** It's opened by `GITHUB_TOKEN`, and
  workflow runs aren't triggered by the default token. The required checks (Wiz, CodeQL)
  come from org-level apps and still report; `ci.yml` won't. A version bump only touches
  `package.json` and CHANGELOG files, so this is acceptable — but don't hand-edit anything
  else into that PR expecting CI to vet it.

Tags are unaffected by the branch rulesets (they target branches, not tags), so
`changeset publish` can push its per-package tags normally. This repo currently has no
tags — version history for these packages lives in the source repos.

The three changesets pending as of activation will produce one Version PR taking the fixed
group to `0.9.0`, then four GitHub Releases when it's published.

## The code registry (not an npm package)

The P1 block registry (`apps/p1-registry`) is a static site that distributes
blocks via the shadcn CLI — it is not published to npm and has no changeset
flow. See [docs/registry.md](registry.md) for the full consuming and releasing
workflow. In brief: bump `meta.version` in `registry/p1/blocks/registry.json`,
run `verify:registry`, merge to `main`, and trigger the deploy workflow.

## Releases for things that aren't npm packages

Every independently deployable piece should have its own GitHub Release. For npm packages
that's what the per-package tags and releases above give you. The workers deploy via
**Deploy Workers**, whose `release` job cuts one GitHub Release per worker that reached
production (`.github/scripts/worker-release.sh`). Staging deploys are not released — a
release records what is in production.
