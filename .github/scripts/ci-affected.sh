#!/usr/bin/env bash
# Which of CI's expensive jobs can this change actually reach?
#
# Prints `<scope>=true|false` for each scope and appends them to $GITHUB_OUTPUT,
# so the jobs below can sit out the PRs they cannot possibly be affected by.
#
# Package-level detection is turbo's: `turbo ls --affected` walks the real
# workspace graph and the lockfile, so nothing here hand-maintains a dependency
# closure. What turbo cannot see is the files belonging to no workspace package
# — the e2e specs, the Playwright config, this workflow — so those stay an
# explicit list.
#
# Only pull requests are scoped. The checkout is depth 2 of the merge commit,
# whose first parent is the base branch. Any other event runs everything, and so
# does any failure to work out the answer.
set -euo pipefail

SCOPES='starter-components e2e'

# Whichever of these turbo reports as affected means the job must run.
scope_packages() {
  case "$1" in
    starter-components) echo '@pantheon-systems/p1-starter-components @pantheon-systems/p1-registry' ;;
    e2e) echo '@pantheon-systems/p1-starter' ;;
    *) echo "unknown scope: $1" >&2; exit 2 ;;
  esac
}

# Files the job reads that belong to no workspace package, so turbo cannot
# attribute them. `//#lint:root` in turbo.json covers the same blind spot.
ROOT_PATHS='
^\.github/workflows/ci\.yml$
^\.github/scripts/ci-affected\.sh$
'
scope_paths() {
  case "$1" in
    e2e) printf '%s\n^e2e/\n^playwright\\.config\\.ts$\n' "$ROOT_PATHS" ;;
    *) printf '%s\n' "$ROOT_PATHS" ;;
  esac
}

turbo_cmd() {
  npx --yes "turbo@$(node -p "require('./package.json').devDependencies.turbo")" "$@"
}

affected_packages() {
  TURBO_SCM_BASE=HEAD^1 turbo_cmd ls --affected --output=json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const items = JSON.parse(s).packages?.items ?? [];
      console.log(items.map((i) => i.name).join("\n"));
    })'
}

self_test() {
  local failures=0 known
  known=$(turbo_cmd ls --output=json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      console.log((JSON.parse(s).packages?.items ?? []).map((i) => i.name).join("\n"));
    })')
  # A scope naming a package that no longer exists would never match, and the
  # job would quietly stop running.
  for scope in $SCOPES; do
    for pkg in $(scope_packages "$scope"); do
      if ! printf '%s\n' "$known" | grep -qxF "$pkg"; then
        echo "FAIL: [$scope] no workspace package named $pkg"
        failures=$((failures + 1))
      fi
    done
  done

  assert() {
    local scope="$1" expected="$2" path="$3" actual=out-of-scope
    printf '%s\n' "$path" | grep -qE "$(scope_paths "$scope" | grep -v '^$' | paste -sd '|' -)" && actual=in-scope
    if [ "$actual" != "$expected" ]; then
      echo "FAIL: [$scope] $path -> $actual, expected $expected"
      failures=$((failures + 1))
    fi
  }
  assert e2e in-scope 'e2e/p1-starter.spec.ts'
  assert e2e in-scope 'playwright.config.ts'
  assert starter-components out-of-scope 'e2e/p1-starter.spec.ts'
  for scope in $SCOPES; do
    assert "$scope" in-scope '.github/workflows/ci.yml'
    assert "$scope" out-of-scope 'docs/migration/STATUS.md'
    assert "$scope" out-of-scope 'workers/ccr/src/index.ts'
  done

  if [ "$failures" -ne 0 ]; then echo "$failures self-test failure(s)"; exit 1; fi
  echo "self-test passed"
}

if [ "${1:-}" = "--self-test" ]; then self_test; exit 0; fi

UNSCOPED=''
if [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ] || ! git rev-parse -q --verify HEAD^1 >/dev/null; then
  echo "not a scoped event — running everything"
  UNSCOPED=yes
fi

if [ -z "$UNSCOPED" ]; then
  CHANGED=$(git diff --name-only HEAD^1 HEAD)
  if ! AFFECTED=$(affected_packages); then
    echo "could not resolve the affected packages — running everything"
    UNSCOPED=yes
  fi
fi

for scope in $SCOPES; do
  result=false
  if [ -n "$UNSCOPED" ]; then
    result=true
  elif printf '%s\n' "$CHANGED" | grep -qE "$(scope_paths "$scope" | grep -v '^$' | paste -sd '|' -)"; then
    result=true
  else
    for pkg in $(scope_packages "$scope"); do
      if printf '%s\n' "$AFFECTED" | grep -qxF "$pkg"; then result=true; fi
    done
  fi
  echo "$scope=$result"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$scope=$result" >>"$GITHUB_OUTPUT"; fi
done
