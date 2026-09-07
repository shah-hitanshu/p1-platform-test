---
"@pantheon-systems/css-client": minor
---

**[Added]** Name how a new locale version's content is seeded.

### What Changed
- `client.translations.create()` accepts a `mode`. `copy` brings the source page's content across to translate in place, and is the only mode available; omit it to take the server's default.
- A mode the server does not implement is refused rather than quietly copied, so a caller asking for content the backend cannot produce learns so.
