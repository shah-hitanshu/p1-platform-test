---
"@pantheon-systems/css-client": minor
---

**[Feature]** A document now reports the page it was localized from.

`Document.localizedFromId` names the canonical a translation derives from, and is null when a document derives from nothing. A locale tells you which language a page is written in, which is a separate question: a page authored in a market carries a locale and is nobody's translation, so this field rather than the locale is what distinguishes the two.
