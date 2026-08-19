---
"@pantheon-systems/puck-css": patch
---

**[Fix]** Template references to hyphenated datasource ids (e.g. `{{ blog-post.title }}`) now resolve; previously they were never fetched and rendered as an empty string.

### What Changed
- P1 auto-generates content-type datasource ids in kebab-case (`blog-post`, `customer-story`). Template resolution only accepted `A–Z`, `a–z`, `0–9`, and `_` in datasource ids, so hyphenated ids were silently skipped during datasource loading and evaluated to `""` at render time. Both plain (`{{ blog-post.title }}`) and namespaced (`{{ templates.blog-post.title }}`) references now resolve, including `.markdownLinks` expansion.
