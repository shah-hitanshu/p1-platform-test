---
"@pantheon-systems/p1-next-sdk": patch
---

Fix the post-login redirect landing on `localhost:3000` instead of the site's real public URL. `postBrokerLogin` derived its redirect origin from the Route Handler's `request.url`, which reflects the Node server's own bind address once a reverse proxy is involved rather than the Host the browser actually requested. It now reads the `host` header instead, with `P1_SITE_URL`/`p1SiteUrl` still taking priority when set.

`x-forwarded-host` is deliberately not consulted: on Pantheon it is not validated the way `Host` is (an arbitrary `Host` is rejected upstream; an arbitrary `X-Forwarded-Host` is not), so trusting it here would let a request redirect a login to an attacker-controlled origin. (PCC-3574)

Also, from the same review: a malformed `P1_SITE_URL`/`p1SiteUrl` no longer throws and 500s the login route -- it falls back to the request's own origin and logs a warning instead.
