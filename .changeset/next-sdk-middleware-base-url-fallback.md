---
"@pantheon-systems/p1-next-sdk": patch
---

**[Fix]** `createP1Middleware` no longer requires a `cssBaseUrl` — an omitted or blank value now defaults to the production CCR backend, matching every other config path.

### What Changed
- `P1MiddlewareConfig.cssBaseUrl` is now optional. Leaving `NEXT_PUBLIC_CSS_BASE_URL` unset, or set but blank, connects the middleware to the production backend instead of failing to connect at all.
