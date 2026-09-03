---
"@pantheon-systems/puck-css": minor
---

**[Feature]** Translated pages can now diverge from the page they came from, field by field.

### What Changed

- Editing a translation, every text field carries a control to break its link to the source page. A broken field keeps whatever the translator types; an unbroken one follows the source. Breaking is reversible: resetting a field puts it back under the source's control and discards the local wording.
- Editing a canonical page, every text field carries a control to mark it non-translatable. That holds the field identical across every language version of the page, for things like product names and codes that should not be reworded.
- A field's setting comes from the most specific answer available: an explicit choice on the field, otherwise what the page's template declares for that slot, otherwise the site's default. A field nobody has spoken for follows the source page.
- The controls reach single-line and multi-line text fields, which is where translatable wording lives; other field types are unaffected for now. They sit on a page's own fields and on the top-level fields of each component. A field nested inside a group or a repeated item follows the field it belongs to, which is where the setting is held.

The field controls stay out of the way where they do not apply, so fields on a page with nothing to diverge from look as they did before.
