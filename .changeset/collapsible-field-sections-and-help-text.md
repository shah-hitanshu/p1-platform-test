---
'@pantheon-systems/puck-css': minor
'@pantheon-systems/p1-next-sdk': patch
---

**puck-css:** The right-hand inspector supports **collapsible field sections** and
**per-field help text**, both opt-in through Puck's per-field `metadata` so existing
configs render unchanged.

Help text is declared as `metadata: { help, helpWhenEmpty }` and renders beneath the input.
`help` always shows; `helpWhenEmpty` shows only while the field has no value, which is how
an inheriting field can say where its value is coming from — a field inherits exactly while
it's empty. Fields declaring neither key are untouched.

`PRODUCTION_BASE_URL` is now re-exported from `@pantheon-systems/puck-css/server`, so apps
and SDKs can resolve the default backend without reaching into internals.

**p1-next-sdk:** Broker login no longer fails when no backend URL is configured. An unset
`p1BaseUrl` (neither `CSS_BASE_URL` nor `NEXT_PUBLIC_CSS_BASE_URL` set) now falls back to
the production backend for both the login and redeem calls, matching what
`createNextConfig` and `createNextContentClient` already did. Previously an unset value was
passed straight through and the login round-trip failed.
