---
"@pantheon-systems/css-client": patch
---

**[Fix]** `P1ContentClient` and `brokerLogout` no longer require a base URL — an omitted or blank value now defaults to the production CCR backend, so every consumer that constructs one gets the safe default automatically instead of having to apply its own.

### What Changed
- `P1ContentClientConfig.baseUrl` and `BrokerLogoutConfig.cssBaseUrl` are now optional. Leaving either unset, or set but blank, resolves against the production backend instead of failing to connect.
- `PRODUCTION_BASE_URL` is now exported from the package root, alongside its existing exports.
