---
"@pantheon-systems/puck-css": minor
---

**[Feature]** Create a page in one of a site's markets, or bring an existing page into a market.

### What Changed
- The create-page modal takes a market for a new page. The field is bounded to the site's locale registry and searchable by native name, English name and tag, so `Deutsch`, `German` and `de` all reach the same market. Carrying no market is the field's empty state rather than a row in the list, and clearing the field returns to it.
- A fifth starting point brings an existing page into a market as a version of it, seeded from a copy of the page's current content. The editor lands on the new version once it exists.
- A control elsewhere in the editor can open this flow already aimed at a market and at the page a version starts from, so a market settled before the modal opened is carried into it.
- Where the site's locales cannot be read, the translate flow says so and offers another go rather than reporting that the site has no markets configured.

### Host-side change to be aware of
`onDocumentCreate` takes a fourth argument: `(path, template?, title?, locale?)`. `locale` is the market a new page is created in.

A host that implements the callback with three parameters keeps compiling and keeps working, but **drops the market silently** — pages created through the modal's locale field come out untagged, with no error raised anywhere. If your host forwards these arguments on, widen it to pass the fourth through:

```ts
onDocumentCreate={(path, template, title, locale) =>
  createDocument(path, template, title, locale)
}
```
