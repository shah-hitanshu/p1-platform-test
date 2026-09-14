---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/css-client": minor
---

**[Feature]** A site can publish a page in several markets, and keep each version in step with the page it came from.

### Publishing a page in several markets

- A site declares the markets it publishes in, along with the policy for serving a page that has no version in a visitor's locale.
- The create-page modal takes a market, searchable by native name, English name or tag, so `Deutsch`, `German` and `de` all reach the same one.
- A fifth starting point in that modal brings an existing page into a market as a version of it, seeded from a copy of the page's content.
- The editor toolbar names the market the open page belongs to and lists the site's others. A market holding a version of the page opens it; a market holding none offers to create one. A page carrying no locale reads `Unset`.

### Deciding what each version owns, field by field

- On a canonical page, a field can be marked non-translatable, holding it identical in every language, for things like product names and codes that should not be reworded.
- On a translation, a field can be given its own wording, breaking its link to the source page. Breaking is reversible: resetting the field puts it back under the source's control and discards the local wording.
- Both are set from a button on the field's own label, which says which of the three the field is: translated per language, held identical in every language, or written for this language alone. It stays out of sight until the field is hovered, as does the button that connects a field to data.
- A field with no setting of its own takes the one its slot's template declares, then the site's default, and otherwise follows the source page.
- Single-line, multi-line and rich text fields carry the setting, on a page's own fields and on the top-level fields of each component. A field nested in a group follows the group, and is set from the group's heading.

### Seeing what changed on the source page

- The editor toolbar carries how far behind its source a translated page is, and only while there are changes to deal with.
- Opening it lists what changed on the source page since the last sync, grouped by who owns the value, with each source value set beside this page's. An inherited change can be applied outright, one needing translation can seed a draft to work from, and an advisory one can be dismissed.
- A value is marked with the language it is written in, so text in a right-to-left or non-Latin script is laid out and read as that language rather than as the page around it.
- Applying a change is an ordinary edit: it rides the page's autosave and can be undone like any other.
- Dealing with a change is recorded, so it stops being reported and progress survives a reload. Each change settles on its own, seeding a draft does not settle one, and a field the source page changes again is reported afresh.
- A record is scoped to the branch it was made on and pins the version the reconciler was shown, so a change made while they worked stays on the list. A change that could not be recorded stays on the list and says so.

### Client API

- `sites.getSettings` reads a site's settings, including the locales it publishes in.
- `translations.create` makes a locale version of a page, linked to the page it came from, and takes a `mode` naming how its content is seeded. `translations.listVariants` lists every locale a page has been translated into.
- `getAuthorityOverrides`, `setAuthorityOverride` and `clearAuthorityOverride` read and change whether a prop on a translation follows the original or belongs to the translation, returning the template and site-wide fallbacks alongside.
- `relations.getUpstreamDiff` reports what has changed on the page a translation derives from, classifying each change as structural, a plain prop edit, one already applied for you, one needing translation, or advisory only. It works for pages derived from a template too.
- Per-change resolutions can be read, recorded and cleared, several at once, with the reconciled changes available alongside the outstanding ones.
- `Document.localizedFromId` names the canonical a translation derives from, and is null when a document derives from nothing. Pages carry an optional `locale`.

### Fixed

- Text fields no longer carry a translation control on a site with no locales configured.
- Dropdown fields in the inspector no longer cut off the option they are showing.

### Host-side change to be aware of

`onDocumentCreate` takes a fourth argument: `(path, template?, title?, locale?)`. `locale` is the market a new page is created in.

A host that implements the callback with three parameters keeps compiling and keeps working, but **drops the market silently** — pages created through the modal's locale field come out untagged, with no error raised anywhere. If your host forwards these arguments on, widen it to pass the fourth through:

```ts
onDocumentCreate={(path, template, title, locale) =>
  createDocument(path, template, title, locale)
}
```
