---
"@pantheon-systems/puck-css": patch
---

CI registry sync no longer rewrites unchanged components. The backend now
compares each posted registry descriptor against what the branch already
stores and writes a version only when it differs, so a sync run over an
unchanged component set adds no document history. The `write:registry` token
still has no read access — the comparison happens server-side.

The example GitHub Actions workflow in the starter kit's `ci-examples/` now
ships with a concurrency group, so repeated pushes to a branch no longer race
parallel sync runs into the same registry documents. Sites already running a
copy of that workflow should add the same `concurrency` block.
