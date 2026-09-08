---
"@pantheon-systems/puck-css": patch
---

**[Fix]** `performLogout` no longer requires a `cssBaseUrl` — an omitted value now defaults to the production CCR backend, matching every other config path.

### What Changed
- `PerformLogoutConfig.cssBaseUrl` is now optional. When omitted, logout resolves against the production backend instead of requiring the caller to supply a value.
