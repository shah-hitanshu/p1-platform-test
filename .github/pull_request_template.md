<!--
Title format: {feat|fix|refactor|revert}: {descriptor} [{TICKET-ID}]
Keep sections below; delete only the ones marked optional if not applicable.
-->

## Summary

**Jira:** [PCC-XXXX](https://getpantheon.atlassian.net/browse/PCC-XXXX)

<!-- 2–4 sentences: what this changes and why. Assume the reader hasn't seen the ticket. -->

## Changes

<!-- Bullet list, behavior-level ("Templates authored on main now appear on feature branches"), not file-level. -->

## For bugs: repro & root cause  <!-- delete section if not a bug fix -->

**Repro (before this PR):**
<!-- Numbered steps + what wrong behavior you'd see. -->

**Root cause:**
<!-- Why it happened — not just what the fix does. -->

## How to test

<!-- Checkboxes a reviewer can actually run. Say WHERE (which app/env — dashboard,
Puck editor, local dev) and what the broken/old behavior was, so the reviewer can
confirm the change and not just the happy path. -->

- [ ]

## Risk & rollout  <!-- delete if trivially safe -->

<!-- Migrations? Feature flags? Backward compat with main-branch behavior? Rollback plan? -->