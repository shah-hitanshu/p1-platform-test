---
"@pantheon-systems/css-client": minor
---

**[Added]** Read a site's settings, including the locales it publishes in.

### What Changed
- `client.sites.getSettings(siteId)` returns the site's settings and, when the server reports them, the number of documents in each configured locale.
- `settings.locales` names the site's markets in the order editors should see them, along with the policy for serving a page that has no version in a visitor's locale.
