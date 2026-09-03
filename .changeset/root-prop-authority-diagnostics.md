---
"@pantheon-systems/p1-content-validator": minor
---

**[Fix]** Authority checks now cover a page's own fields, not just the fields of components placed on it.

A write to a page-level field of a translation — its title, its description — was passed over without judgement, because those fields belong to no component. They are now judged against the same inheritance rules as any other field, so editing one that the source page owns reports it. The editor's own bookkeeping, which shares the same place on a page as those fields, is left out of the judgement.
