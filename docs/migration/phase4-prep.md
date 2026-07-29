# Phase 4 prep — done before the migration PR merges (2026-07-23)

Everything here is merge-independent: identity keys off the repo name, not main's content.
Only workflow *activation* waits for the merge.

## 1. WIF trust change — PR open (2026-07-29)

Fired as [collaborative-state-system#228](https://github.com/pantheon-systems/collaborative-state-system/pull/228)
(ticket PCC-3512; branch `wif/trust-p1-platform`, rebased onto main as `ae4779d`). One line:
`additional_repos = ["p1-media-r2", "p1-platform"]`.

Remaining: review/merge #228, then old repo's deploy-infra → staging plan → review
(**additions only** — expect 8 IAM member adds: workloadIdentityUser + tokenCreator × 2 SAs
× 2 envs) → apply → production. The monorepo's copy of the module already mirrors the
change (commit `5295ff3`).

## 2. GitHub environments — created on p1-platform ✅

`staging` and `production` environments exist with the same vars as the old repo
(GCP_SERVICE_ACCOUNT, GCP_PROJECT_ID, CLOUDFLARE_ACCOUNT_ID, CLOUDSQL_INSTANCE_CONNECTION_NAME,
CLOUDSQL_DB_NAME per env; STAGING_/PRODUCTION_GCP_PROJECT_ID + _CLOUDFLARE_ACCOUNT_ID at repo
level). Inert until workflows reference them; deletable anytime.

**Finding:** the old repo's environments have **zero required reviewers** — the "protected
environments" claim in its README was aspirational. Decide whether p1-platform's production
environment should actually require reviewers (recommended) before deploy workflows activate.

## 3. npm inventory

All 7 packages share one maintainer set: `pantheon-npm` (vendor-npm@pantheon.io — the org
account, likely where trusted-publisher config is managed) plus cobypear, zzyou, cat.kaethler,
danishyasin33, duncanschouten, mitchellmarkoff, mel-miller.

Published versions as of 2026-07-23 (delta-sync must reconcile before any monorepo release):
css-client / puck-css / p1-next-sdk / create-p1-starter-kit **0.7.0**, p1-ai-chat **0.1.2**,
p1-content-validator **2.0.0**, p1-media-r2 **0.2.0**.

TODO during the swap: verify whether npm now supports multiple trusted publishers per package;
if single-config, the re-point is a swap (old repo loses publish ability immediately) — do it
per-package right before the proof release, not early.

## 4. Delta-sync sizing (source commits since import)

| Repo | New commits on main |
|---|---|
| collaborative-state-system | 7 |
| puck-css-integration | 10 |
| p1-chatbot | 4 |
| p1-media-r2 | 0 |

21 commits total — a small sync. Procedure in STATUS.md "Import baseline".

## Still gated on the PR #1 merge (+ ruleset bypass)

- Moving staged workflows into `.github/workflows/` (publish triggers on push to main).
- The proof release and the deploy validation ladder.
- Branch-protection/required-checks tuning on main.
