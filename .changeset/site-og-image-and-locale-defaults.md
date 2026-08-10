---
'@pantheon-systems/css-client': minor
---

`SeoMetadata` on the content payload gains two optional site-wide defaults, `ogImage` and
`ogLocale`. A page that leaves either field empty now inherits the site's value instead of
omitting the tag, so the resolution order is page value → site default → omit.

Both are additive and optional, so an un-upgraded consumer of the payload keeps working;
reading the new fields just requires this version's types.
