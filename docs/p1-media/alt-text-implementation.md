# Task: Add editor-controlled alt text to Puck image components

These instructions are for the repo that **consumes** the `@pantheon-systems/p1-media`
Puck plugin (a site/editor codebase — not the plugin repo). Do not modify the plugin
package or the media Worker.

## Context

- The site registers the plugin via `createMediaPlugin(...)` and passes it to `<Puck plugins={[...]}>`.
- The plugin overrides Puck's `text` field type: any text field whose **name** matches a
  media pattern is replaced with a media-library picker. The stored value is a plain
  **string** — a CDN image URL, possibly with crop params (e.g. `?fit=cover&gravity=auto`).
- Default media field-name patterns (used unless the site passes `fieldNamePatterns` to
  `createMediaPlugin` — check the call site):

  ```
  /^image(?:Url)?$/  /^logo(?:Url)?$/  /^media(?:Url)?$/  /^icon(?:Url)?$/
  /^thumbnail(?:Url)?$/  /ImageUrl$/  /LogoUrl$/
  ```

- Today, components render these images with missing or hardcoded `alt` attributes.
  There is no alt capability anywhere in the system.

## Goal

Every image rendered from a media field gets an `alt` attribute whose value content
editors control from the Puck sidebar, via a sibling plain-text field.

## Naming convention (critical)

For a media field named `X`, the alt field is named by **stripping a trailing `Url`
and appending `Alt`**:

| Media field     | Alt field       |
|-----------------|-----------------|
| `imageUrl`      | `imageAlt`      |
| `heroImageUrl`  | `heroImageAlt`  |
| `logo`          | `logoAlt`       |
| `thumbnail`     | `thumbnailAlt`  |

The alt field name must **not** match any media pattern, or the plugin will replace it
with another image picker. The `…Alt` suffix rule guarantees this for the default
patterns. If the site passes custom `fieldNamePatterns`, verify each new name against
them before proceeding.

## Constraints

1. Do NOT rename, remove, or retype any existing field — stored Puck documents
   reference fields by name and would break.
2. Do NOT modify `@pantheon-systems/p1-media` or the media Worker.
3. Existing documents have no alt values. Renders must tolerate `undefined`:
   always emit `alt={value ?? ""}`. An empty `alt=""` (decorative image) is correct
   HTML; an **omitted** alt attribute is an accessibility failure. Never omit it.
4. Match the codebase's existing style for field definitions, defaultProps, and tests.

## Steps

### 1. Inventory

- Find the `createMediaPlugin` call. Note whether `fieldNamePatterns` is customized.
- Find the Puck `config` (the object with `components: { ... }`). For every component,
  list each field whose name matches the media patterns. Include fields nested in
  `type: "array"` item definitions (e.g. a `slides` array whose items contain
  `imageUrl`) — the plugin matches on the bare last segment of the field name, so
  array item fields are media fields too.
- Also note any component that already has an alt-like field: skip adding a duplicate,
  but verify it is actually rendered into the `alt` attribute.
- Produce the inventory (component → media fields → planned alt field names) before
  editing anything.

### 2. Add fields

For each media field, add a sibling text field immediately after it in the component's
`fields` definition:

```ts
heroImageUrl: { type: "text", label: "Image" },        // existing — do not touch
heroImageAlt: { type: "text", label: "Alt text" },     // new
```

If the component defines `defaultProps`, add the alt field with a default of `""`.
For array item fields, add the alt field to the array's item field definition and to
the array's item defaults if present.

### 3. Render the alt

In each component's render function:

- Plain `<img>`: `alt={heroImageAlt ?? ""}`.
- Next.js `<Image>` (alt is a required prop): replace whatever placeholder/hardcoded
  value is there with the field value, defaulting to `""`.
- CSS `background-image`: `alt` does not apply. If the image conveys information, add
  `role="img"` and `aria-label={alt}` to the element only when alt is non-empty;
  if it is purely decorative, leave the element unchanged. List these cases in your
  final report either way.

### 4. Tests

Follow the repo's existing component-test conventions. For at least one representative
component (and one array-based component if any exist), assert:

- When the alt prop is set, the rendered `<img>` carries that alt text — editors'
  descriptions must reach the DOM for screen readers.
- When the alt prop is absent (legacy documents), the image still renders with
  `alt=""` — missing metadata must degrade to "decorative", never to an invalid
  missing attribute.

### 5. Verify end-to-end

1. Run the editor locally. Open or create a page using each changed component.
2. Confirm the sidebar shows **Alt text** as a plain text input directly below the
   image picker. If it renders as another image picker, the field name collides with
   the media patterns — rename per the convention and re-check.
3. Enter alt text, then view the rendered/preview page and inspect the DOM: the `<img>`
   must carry the entered `alt`.
4. Load a pre-existing page (no alt values set) and confirm it renders without errors
   and images have `alt=""`.

### 6. Report

Finish with a summary table: component, field(s) added, render change made,
plus a list of background-image/aria-label cases and any components skipped (with
reasons). Report test results honestly, including anything not verified.

## Out of scope

- Asset-level metadata storage (that is a separate server-side project).
- Changing the media field value to an object, data migrations, plugin/Worker changes.
- Adding alt to images that do not come from media fields (flag them in the report
  instead if you notice them).
