#!/usr/bin/env bash
# Cut a GitHub Release recording that one worker reached production.
#
# Workers are private packages with frozen, meaningless package.json versions, so
# the tag is dated rather than semver: <worker-name>/<UTC date>-<run number>. The
# run number keeps same-day deploys distinct and ordered.
#
# Usage: worker-release.sh <wrangler-worker-name> <worker-directory>
set -euo pipefail

worker="${1:?worker name required}"
dir="${2:?worker directory required}"
tag="${worker}/$(date -u +%Y.%m.%d)-${GITHUB_RUN_NUMBER}"

# Re-running a workflow reuses its run number, so the tag can already exist.
if gh release view "$tag" >/dev/null 2>&1; then
  echo "Release $tag already exists — nothing to do."
  exit 0
fi

previous=$(git tag --list "${worker}/*" --sort=-v:refname | head -n 1)

if [ -n "$previous" ]; then
  changes=$(git log --no-merges --pretty='- %s (%h)' "${previous}..${GITHUB_SHA}" -- "$dir")
  body="Deployed \`${worker}\` to **production** at commit ${GITHUB_SHA}.

Previous production release: \`${previous}\`

## Changes in ${dir} since then
${changes:-_No changes to this worker between releases (deployed as part of a platform-wide deploy)._}"
else
  body="Deployed \`${worker}\` to **production** at commit ${GITHUB_SHA}.

First recorded production release for this worker."
fi

gh release create "$tag" \
  --target "$GITHUB_SHA" \
  --title "$tag" \
  --notes "$body"
