---
"@pantheon-systems/css-client": minor
---

**[Feature]** Build translated pages: create a locale version of a page, control prop by prop what it inherits from the original, and see how far the original has moved since.

### What Changed

- `translations.create` makes a locale version of an existing page, linked to the page it came from. The path defaults to the original's with the locale appended; pass one to override it.
- `translations.listVariants` lists every locale a page has been translated into.
- Prop authority decides whether a prop on a translation follows the original or belongs to the translation. `getAuthorityOverrides` reads the whole picture, `setAuthorityOverride` changes one prop, and `clearAuthorityOverride` drops a prop's own setting. A prop with no override of its own falls back to what its slot's template declares, and then to a site-wide default, both of which come back with the map, so clearing an override on a slot the template declares locale-owned leaves the prop with the translation.
- `relations.getUpstreamDiff` reports what has changed on the page a translation derives from, classifying each change as structural, a plain prop edit, one already applied for you, one needing translation before it can be taken, or advisory only. It works for pages derived from a template too, not just translations.
- Pages now carry an optional `locale`.

Nothing to do on upgrade; all of this is additive.
