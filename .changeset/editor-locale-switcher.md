---
"@pantheon-systems/puck-css": minor
---

**[Added]** The editor toolbar names the market a page belongs to and lists the site's others.

### What Changed
- The localization feature contributes a control to the document toolbar showing the open page's market, with every market the site publishes in beneath it.
- A market holding a version of the page opens it; a market holding none offers to create one.
- The list reads the same wherever in a page's locale set the editor is standing, because a version resolves up to its canonical before the list is built.
- Markets are named in their own language and in English, so a tag is never the only label a reader gets. A page carrying no locale reads `Unset`.
- A locale a document carries but the site no longer configures is still listed, after the configured markets, so a version that exists stays reachable.
- The control stays away until a page is open, rather than naming a market it has no page to measure against.
- Where the site's locales cannot be read, the control says so and offers another go. A site that publishes in nothing and a request that failed no longer look alike.
- Where two pages carry the same locale, both are listed and each names its own page, so neither is left unreachable and the rows can be told apart.
