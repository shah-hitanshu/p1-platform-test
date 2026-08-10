---
"@pantheon-systems/p1-next-sdk": patch
"@pantheon-systems/css-client": patch
---

Complete the SDK half of removing the per-environment `P1_SITE_URL` requirement (PCC-3531 phase 3). A multidev inherits its site's `P1_SITE_URL` at provisioning time, which points at the wrong environment with no error -- that cannot be fixed operationally, only by no longer depending on it.

The browser has always known its own origin; it just never said so. `css-client`'s `login()` now states it -- `{ origin }` in proxy mode, `{ proposedRedirectUrl }` in direct mode, since direct mode has no server hop to compose the URL -- and `p1-next-sdk`'s `postBrokerLogin` forwards it upstream as `proposedRedirectUrl`, but only when neither `P1_SITE_URL`/`p1SiteUrl` nor an explicit `redirectUrl` is configured: a configured site's request is byte-identical to before this existed. Neither layer makes a trust decision -- CCR is the only party that authenticates the site, so it is the only place the proposal is checked against the site's registered origins (already live; this was the unused half).

Also fixes a disclosure this same mechanism created: `/p1/auth/login` is a public, unauthenticated endpoint, and CCR's decline-warning was being returned straight through in the response body, letting a caller probe whether a given origin is registered for a site by watching the warning appear or vanish. The warning is now logged server-side with a `[P1AuthHandler]` prefix and stripped before the response reaches the browser.
