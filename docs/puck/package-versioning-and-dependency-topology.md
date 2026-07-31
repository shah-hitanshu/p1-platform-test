# Package Versioning & Dependency Topology — Problem, Research, and North Star

**Status:** proposal for review · **Date:** 2026-07-27 · **Scope:** `css-client`, `puck-css`, `p1-next-sdk`, `create-p1-starter-kit`

## TL;DR

While cutting the persistent-editor release (a breaking change in `p1-next-sdk`), we found that **any non-`patch` changeset bumps the whole package suite straight to `1.0.0`, not `0.8.0`.** It's reproducible: `patch → 0.7.1`, but `minor → 1.0.0` and `major → 1.0.0`.

The cause is a redundant overlap in our release config: the four packages are a changesets **`fixed` lockstep group**, *and* `p1-next-sdk` lists two of the others (`css-client`, `puck-css`) in its **`peerDependencies`**. `fixed` force-releases the peers on every release; changesets' default rule then treats a peer's non-patch release as breaking and promotes the dependent to a **major** bump. That feeds back through the fixed group and lands everyone on `1.0.0`.

**North star:** keep `fixed` for lockstep, but make every edge *between our own packages* a plain `dependency`, and reserve `peerDependencies` for app-owned externals only (`react`, `react-dom`, `next`, `@puckeditor/core`, `pds-toolkit-react`). Peers and lockstep are two tools for the same job — a single shared version — and using both on the same edge is what creates the cascade. After the fix, `minor → 0.8.0` as expected, with lockstep and single-instance guarantees intact.

---

## 1. Context: how we hit this

The persistent-editor work makes `p1-next-sdk`'s `createP1Pages()` render from a layout instead of a page — a breaking change for consumers. Following the repo convention (pre-1.0, breaking changes ship as a `minor`), we wrote a `minor` changeset expecting `0.7.0 → 0.8.0`.

`changeset version` produced **`1.0.0`** for all four packages instead. That matters because:

- **The version number stops matching the changeset's intent.** You can't read the next version off the bump keyword, which breaks release planning and any docs that name a version.
- **It's not a one-off.** This fires on *every* future non-patch release of any of the four — the suite can't make a non-patch `0.x` release at all; the next one graduates everything to `1.0.0`.
- **`1.0.0` is a semver commitment.** Declaring 1.0 by accident tells every consumer "this API is now stable and breaking changes will be rare/major-gated" — a product statement, not a mechanical detail.

## 2. Root cause

Three settings interact. None is wrong alone; together they cascade.

1. **`fixed` group** (`.changeset/config.json`) — the four packages share one version and are always released together at the highest bump requested for any of them. A changeset naming only `p1-next-sdk` drags the other three into the same release.
2. **`p1-next-sdk` peer-depends on `css-client` and `puck-css`** (declared in `peerDependencies`, currently alongside the same entries in `dependencies`).
3. **Changesets' default `onlyUpdatePeerDependentsWhenOutOfRange: false`** — when a package's *peerDependency* gets any release above `patch`, the dependent is force-bumped to **major** (a peer change is presumed breaking). Confirmed in `@changesets/assemble-release-plan` `shouldBumpMajor` (it excludes only `none`/`patch`).

### It's a converging feedback loop, not an infinite one

`changeset version` runs a `while` loop that repeats "promote dependents" + "re-level the fixed group to the highest type" until a pass changes nothing. It operates on bump **types** (`patch < minor < major`), which only ratchet up and cap at `major`; the version number is computed **once** at the end via `semver.inc`. So it settles, it doesn't spin.

Trace for `p1-next-sdk: minor`, all packages at `0.7.0` (tracking each package's bump **type** per pass; `—` = not releasing):

| Pass | css-client | puck-css | p1-next-sdk | create-p1-starter-kit | what happened |
|---|---|---|---|---|---|
| start (changeset) | — | — | **minor** | — | only the SDK has a changeset |
| 1 · fixed re-level | minor | minor | minor | minor | `fixed` forces all four to the group's highest type (minor) |
| 2 · promote dependents | minor | minor | **major** | minor | css-client & puck-css are now releasing; `p1-next-sdk` **peer-depends** on both → promoted to major |
| 2 · fixed re-level | **major** | **major** | major | **major** | highest type is now major → all four leveled to major |
| 3 · check | major | major | major | major | nothing changed → loop exits |

Then the version is applied once, from the settled type:

| Package | final type | `semver.inc("0.7.0", type)` |
|---|---|---|
| css-client · puck-css · p1-next-sdk · create-p1-starter-kit | major | **1.0.0** |

`create-p1-starter-kit` only has dev-deps on the others, so it's dragged by `fixed` but drives nothing. The single feedback edge is **`p1-next-sdk` → (peer) → css-client, puck-css**.

## 3. What we researched to resolve it

All tested empirically against the repo (each reverted afterward):

| Question / lever | Result | Why |
|---|---|---|
| Does changesets have a **pre-1.0 / "zero-ver" mode** (make `major` mean `0.8.0`)? | **No** | Config schema has 13 options; none remap bump levels for `0.x`. Version increment is plain `semver.inc` with no `<1.0` branch. It's a deliberate changesets design (open "0ver" requests, never implemented). |
| Author a `patch` changeset instead | `0.7.0 → 0.7.1` | `patch` peer bumps are exempt from the major rule — but `patch` understates a breaking change. |
| `onlyUpdatePeerDependentsWhenOutOfRange: true` (keep `fixed`) | **still `1.0.0`** | Peer ranges are `workspace:*`, which changesets can't parse as a semver range → reads as "out of range" → promotes to major anyway. |
| `linked` instead of `fixed` | `p1-next-sdk → 0.8.0`, puck-css stays `0.7.0` | `linked` only aligns packages that actually change; it doesn't force-release the peers, so no promotion. **But** versions then drift — the opposite of lockstep. |
| Remove `fixed` entirely | `minor → 0.8.0` | Confirms `fixed` (via the forced peer release) is the trigger. |

Key realization from this: we don't need a "pre-1.0 mode." On `0.x`, a `minor` changeset *already* targets `0.8.0` via semver, and marking breaking changes as `minor` *is* the pre-1.0 convention. The `1.0.0` isn't the bump keyword — it's the peer cascade. So the fix is to remove the cascade, not to find a magic version flag.

`fixed` vs `linked` (the two lockstep tools), for reference:

| | `fixed` | `linked` |
|---|---|---|
| Versions always identical? | Yes, at all times | Only among packages released in the same run |
| Releasing one releases the others? | Yes, all of them every time | No, only the ones with a changeset |
| Can versions diverge over time? | Never | Yes |
| Fit for our goal (lockstep) | ✅ | ❌ (drifts) |

`linked` "fixes" the version number only as a side effect of not force-releasing the peers — at the cost of the lockstep we actually want. The correct fix keeps `fixed` and removes the peer edge instead.

## 4. North star: the correct topology

### Principle

**`peerDependencies` and a `fixed` lockstep group are two mechanisms for the same guarantee — everyone shares one version. Use one per relationship, never both on the same edge.**

- **Peers** → the boundary you *don't* control: the host app's singletons (`react`, `react-dom`, `next`, `@puckeditor/core`, `pds-toolkit-react`). The app owns these; every library must share the app's single instance, and a mismatch *should* error loudly.
- **`fixed` lockstep + plain `dependencies`** → the boundary you *do* control: our own four packages. Lockstep already guarantees one consistent version across the suite — which is exactly what an internal peer dep is trying to enforce. The version *is* the compatibility guarantee.

**Corollary: our four packages should never peer-depend on each other.**

### The dependency graph

Layered DAG; every internal edge is a plain `dependencies: "workspace:*"`:

```
css-client              (leaf: data/transport layer, no internal deps)
   ▲
puck-css     ── dep ──► css-client
   ▲
p1-next-sdk  ── dep ──► puck-css, css-client
create-p1-starter-kit   (no runtime deps; bundles a template at build time)
```

| Package | internal `dependencies` | `peerDependencies` (external only) |
|---|---|---|
| **css-client** | — | `react` *only if it renders/uses hooks*, else none |
| **puck-css** | `css-client` | `react`, `react-dom`, `@puckeditor/core`, `pds-toolkit-react` |
| **p1-next-sdk** | `css-client`, `puck-css` | `react`, `react-dom`, `next`, `@puckeditor/core` |
| **create-p1-starter-kit** | — | — |

The only change in intent vs. today: **`p1-next-sdk` drops `css-client` and `puck-css` from `peerDependencies`** (they remain regular deps). That edge is the cascade's feedback loop.

### The consuming app

The app should declare exactly the suite packages it imports, all at the one lockstep version:

- ✅ `@pantheon-systems/puck-css` — a direct, primary surface (the app imports it heavily: root, `/server`, `/styles`, `/fields`, `/connectable`).
- ✅ `@pantheon-systems/p1-next-sdk` — the Next.js adapter.
- ❌ `@pantheon-systems/css-client` — **remove**; the app never imports it. It's an internal layer pulled transitively. (This cleanup was started in PR #80 and has drifted back.)
- Its own externals: `react`, `next`, `pds-toolkit-react`, `@puckeditor/core`.

### Versioning: keep `fixed`

Lockstep is the goal, so `fixed` is correct; `linked` would let versions drift. Once the internal peer edges are gone, `fixed` behaves as expected because a *regular* internal dep bump only triggers `updateInternalDependencies: patch` (a range update), not the peer→major promotion:

| changeset | result under the north star |
|---|---|
| `patch` on any | whole suite → `0.7.1` |
| `minor` on any | whole suite → `0.8.0` |
| `major` on any | whole suite → `1.0.0` |

### The one tradeoff

Internal peers bought exactly one thing: if a consumer installed `p1-next-sdk@1.0.0` against `puck-css@0.9.0`, the package manager would **error** on the mismatch. Regular deps allow it silently (and would nest two copies → duplicate React context / Puck state). We replace that guardrail with the lockstep contract itself: the suite publishes at one version, the app pins all of them together (`workspace:*` internally, a single `^X` externally), so dedupe prevents duplicates in practice. If we ever want the hard mismatch error back, the right tool is a published compatibility/`engines` check or a preinstall assertion — **not** internal peers, which reintroduce the cascade.

## 5. Actionable plan

1. **`packages/p1-next-sdk/package.json`** — remove `@pantheon-systems/css-client` and `@pantheon-systems/puck-css` from `peerDependencies`; keep them in `dependencies` (`workspace:*`). Leave `react`, `react-dom`, `next`, `@puckeditor/core` as peers.
2. **`packages/puck-css/package.json`** — confirm `css-client` is a plain `dependency` (not also a peer). Keep external peers only.
3. **`apps/p1-starter/package.json`** — remove the direct `@pantheon-systems/css-client` dependency (unused). Keep `puck-css` and `p1-next-sdk`.
4. **Sanity-check the graph** — no package in the suite lists another suite package under `peerDependencies`; `create-p1-starter-kit` stays in the `fixed` group for lockstep but has no runtime edges.
5. **Verify versioning** — with a throwaway `minor` changeset, run `changeset version` and confirm the suite goes `0.7.0 → 0.8.0` (revert after). Confirm `patch → 0.7.1`.
6. **Verify single-instance at publish** — `pnpm pack` the packages and confirm `workspace:*` resolves to the exact suite version, and that a deliberately mismatched install is caught (as validated in PR #80).
7. **Document the contract** — a short note (README or an ADR) stating: the four are a lockstep suite; consumers pin them together; internal edges are regular deps; peers are external-only. This is the durable guardrail that replaces the peer-mismatch error.

**Sequencing vs. the current release:** the topology change is independent of the persistent-editor migration tooling. Decide the immediate release version first (accept `1.0.0` from today's config, or land step 1 so this release is `0.8.0`), then apply the full topology as its own change. Only the `p1-next-sdk` peer removal (step 1) affects *this* release's number; the rest is cleanup that can follow.

## Appendix: evidence & sources

- **Empirical:** all version outcomes above were produced by running `npx changeset version` against the repo with throwaway changesets and config edits, each reverted. `patch → 0.7.1`; `minor`/`major → 1.0.0`; `linked → 0.8.0` (with drift); `onlyUpdatePeerDependentsWhenOutOfRange: true → 1.0.0` (ineffective with `workspace:*` ranges); `fixed` removed → `0.8.0`.
- **Source:** `@changesets/assemble-release-plan@6.0.10` — `shouldBumpMajor` (peer non-patch → major when `onlyUpdatePeerDependentsWhenOutOfRange` is false), `matchFixedConstraint` (force-releases and re-levels the whole fixed group), `applyLinks` (aligns only already-releasing linked packages), and the `while (releasesValidated === false)` fixpoint loop. Config schema: `@changesets/config@3.1.4`.
- **Prior art:** PR #80 (christianyates) validated that `changeset version` keeps exact peer pins in sync via the `fixed` group + `updateInternalDependencies: patch` (no custom sync script needed), switched `p1-next-sdk` peers to `workspace:*`, removed `css-client` as a peer of `puck-css`, and removed the direct `css-client` dep from the starter — the same direction this proposal continues. PR #78 established the release flow (`changeset version` → release PR → manual publish).
