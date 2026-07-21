# @pantheon-systems/p1-media-r2

A Puck editor plugin that adds a media library, a rich `p1-media` field type, and render
helpers for Puck-based P1 sites. Backed by a Cloudflare Worker + R2 + D1 media store — see
the [monorepo README](https://github.com/pantheon-systems/p1-media-r2/blob/main/README.md) for the backend and the
[API reference](https://github.com/pantheon-systems/p1-media-r2/blob/main/docs/openapi.yaml) for calling the Worker directly.

The plugin has two distinct audiences with different levels of involvement.

---

## For component developers

If you are building a Puck component for a P1 site, you do not need to install or configure the plugin. CCR wires it up automatically when it initialises the Puck editor — `workerUrl`, `siteId`, `workstreamId`, and `getAuthToken` all come from CCR context.

There are two ways to author an image field:

- **Basic mode** — name a text field with a standard pattern (below); the picker activates automatically and stores a plain CDN URL string. Render it with `buildImageUrl`.
- **Rich mode** — declare a `p1-media` field; it stores a `MediaValue` object carrying the version URL plus metadata (alt, caption, …). Render it with the `getMediaProps` / `MediaImage` / `MediaFigure` helpers.

Both are supported; basic mode is preserved indefinitely.

### Field naming — auto-detected patterns

Name your image fields using any of the following patterns and the media library picker will appear automatically in the Puck sidebar:

- `image`, `imageUrl`
- `logo`, `logoUrl`
- `media`, `mediaUrl`
- `icon`, `iconUrl`
- `thumbnail`, `thumbnailUrl`
- Any field ending in `ImageUrl` or `LogoUrl`

Navigation URL patterns (`buttonUrl`, `linkUrl`, `ctaUrl`) and alt text fields are excluded.

### Declaring a rich media field (`p1-media`)

The quickest integration is the ready-made component the plugin ships:

```tsx
import { createMediaFigureBlock } from "@pantheon-systems/p1-media-r2";

const config = {
  components: {
    MediaFigureBlock: createMediaFigureBlock({
      mediaBaseUrl: "https://media.p1.pantheon.io",
    }),
  },
};
```

`createMediaFigureBlock` options:

| Option | Default | Description |
|--------|---------|-------------|
| `mediaBaseUrl` | (required) | CDN image origin used to validate value URLs — NOT the Worker API URL |
| `transform` | `{ width: 1200, height: 630, format: "auto" }` | Render-time transform; keep both dimensions (see crop note below) |
| `label` | `"Media Figure"` | Component label in the Puck sidebar |
| `fieldLabel` | `"Photo"` | Label of the media field |
| `schema` | — | `MetadataFieldDef[]` passed to `MediaFigure`; pins figcaption field order/labels |
| `className` / `captionClassName` | — | Forwarded to `MediaFigure` |
| `placeholder` | `"Choose a photo from the media library"` | Rendered when no photo is chosen (or its URL fails validation) |

To put the field on your own component instead, declare it directly. `p1-media` is
registered by the plugin at editor runtime, so it is not part of Puck's built-in `Field`
union — cast the declaration:

```tsx
import type { Field } from "@puckeditor/core";
import { MediaImage, type MediaFieldValue } from "@pantheon-systems/p1-media-r2";

const heroBlock = {
  fields: {
    photo: { type: "p1-media", label: "Photo" } as unknown as Field,
  },
  defaultProps: { photo: null },
  render: ({ photo }: { photo?: MediaFieldValue | null }) => (
    <MediaImage image={photo} mediaBaseUrl={MEDIA_BASE} transform={{ width: 1200, height: 630 }} />
  ),
};
```

### Uploading with metadata

Choosing or dropping files in the library modal stages them in a metadata grid before
anything is uploaded: one row per image, one column per schema field (alt, caption, …).
Filling it is optional — Upload sends whatever is non-empty as metadata defaults on each
asset. Every item's ✎ button opens the same grid to edit an existing asset's metadata
(empty cells clear the field via `PATCH /media/:assetId`).

The grid is keyboard-first: Tab moves through cells, Enter/↓ and ↑ move within a column.
Pasting multi-cell TSV or CSV (e.g. copied from a spreadsheet) fills the grid from the
focused cell. If the first pasted row is a header naming schema fields (`alt`, `caption`,
…), columns are mapped by name instead — and with a `filename` column, rows are matched to
the staged files by filename, so a whole exported sheet can be pasted into any cell.

The edit panel also has **Replace image…**, which uploads a new file as a new immutable
version of the same asset (`POST /media/:assetId/versions`) — placements pinned to older
versions keep serving; metadata is untouched.

The library grid itself is keyboard-navigable (roving tab stop: arrow keys move between
tiles, Enter/Space selects, E edits, Delete removes) and lazily rendered — tiles are
revealed in batches of 60 as you scroll, images load with `loading="lazy"`, and the list
fetches up to the Worker's 500-item cap (use search beyond that).

### Cropping

Crop intent always lives in the value's URL query — the stored value stays a plain CDN URL
(basic mode) or a `MediaValue` whose `url` carries the params (rich mode):

| Editor control | URL params | Notes |
|----------------|------------|-------|
| Fit in | `?fit=scale-down` | Default; never crops |
| Smart crop | `?fit=cover&gravity=auto` | Content-aware crop toward the render transform's aspect ratio |
| Custom… (rich field only) | `?trim.left=…&trim.top=…&trim.width=…&trim.height=…` | Interactive cropper with fixed (1:1, 4:3, 3:2, 16:9) or free aspect ratios; values are source-image pixels |

The render-time `transform` composes on top of the crop: a `trim` region is cut from the
source first, then resized to `width`/`height`. See the
[image transformation params](https://github.com/pantheon-systems/p1-media-r2/blob/main/docs/openapi.yaml)
in the API reference for everything the `/image` route accepts.

### Rendering — basic mode (string value)

The stored value is a clean CDN URL. Use `buildImageUrl` to add size, format, and quality at render time; it preserves the editor's crop intent (`?fit=…&gravity=…`).

```tsx
import { buildImageUrl } from "@pantheon-systems/p1-media-r2";

<img src={buildImageUrl(data.heroImage, { width: 1200, height: 630, format: "webp" })} />
<img src={buildImageUrl(data.thumbnail, { width: 150, height: 150, format: "webp", quality: 80 })} />
```

### Rendering — rich mode (`p1-media` value)

The stored value is a `MediaValue` object. Use the render helpers, which return/apply the
alt text and captured dimensions. **`mediaBaseUrl`** (the CDN image origin) is required and
passed at render — the helpers run in RSC and can't read plugin config, and they fail
closed (empty `src`) for any URL not on that origin. URLs must be `https`, with one
local-dev exception: when the configured base is itself `http` on a loopback host
(`http://localhost:8788` — a local `wrangler dev` worker), same-origin `http` URLs are
allowed so rich values render locally. Production is unaffected (real CDN bases are `https`).

```tsx
import { MediaImage, MediaFigure, getMediaProps } from "@pantheon-systems/p1-media-r2";

const MEDIA_BASE = "https://media.p1.pantheon.io";

// <img>-like wrapper: src + alt + width/height come from the value
<MediaImage image={data.heroImage} mediaBaseUrl={MEDIA_BASE} transform={{ width: 1200, height: 630, format: "webp" }} />

// figure + caption/credit/byline composed generically from the metadata schema
<MediaFigure image={data.heroImage} mediaBaseUrl={MEDIA_BASE} transform={{ width: 1200, height: 630, format: "webp" }} />

// or spread the raw props onto your own element / next/image
const { src, alt, width, height } = getMediaProps(data.heroImage, { mediaBaseUrl: MEDIA_BASE, transform: { width: 1200, height: 630 } });
```

> Pass **both** `width` and `height` in the transform. The editor's crop toggle is carried
> as `?fit=cover&gravity=auto` (smart crop) vs `?fit=scale-down` (fit in), and `fit` only
> changes the output when there is a target aspect ratio to crop against — with a
> width-only transform both modes produce identical pixels and the crop control appears
> to do nothing.

All three helpers accept `string | MediaValue | null | undefined` and render nothing
(`MediaImage`/`MediaFigure` return `null`; `getMediaProps` returns `src: ""`) when the
value is empty or its URL fails origin validation — branch on that for a placeholder.
Full option surface:

**`getMediaProps(value, options)`** → `{ src, alt, width?, height? }`

| Option | Description |
|--------|-------------|
| `mediaBaseUrl` | CDN image origin; validation fails closed without it |
| `transform` | `ImageTransformParams` — `{ width?, height?, format? ("auto" \| "webp" \| "jpeg" \| "png" \| "gif" \| "avif"), quality? }`, merged onto the validated URL, preserving the editor's crop params |

Spread the result onto your own element or `next/image` (with `remotePatterns` set to the
CDN origin — `next/image` fetches server-side).

**`<MediaImage />`** props

| Prop | Description |
|------|-------------|
| `image` | The field value |
| `mediaBaseUrl` / `transform` | As above |
| `alt` | Overrides the value's alt text |
| …anything else | All other `<img>` attributes (`className`, `loading`, `sizes`, …) pass through; `width`/`height` come from the value's captured dimensions |

**`<MediaFigure />`** props

| Prop | Description |
|------|-------------|
| `image` | The field value |
| `mediaBaseUrl` / `transform` | As above |
| `schema` | `MetadataFieldDef[]` (e.g. the fetched `GET /media/schema`) — pins figcaption field order and labels. Without it, the value's own string metadata keys render in key order, which can shift across saves |
| `className` / `captionClassName` | Styling hooks for the `<figure>` and `<figcaption>` |

`alt` renders on the `<img>`; every other non-empty string metadata field renders as an
escaped `<span data-field="…">` inside the `<figcaption>`.

### Stored field value formats

Basic mode — a CDN URL (new keys are `{siteId}/assets/{assetId}/{versionId}-{filename}`; the editor's crop is `?fit=cover&gravity=auto` for smart crop, `?fit=scale-down` for fit-in; a rich value's `url` may instead carry `?trim.…` from the custom cropper):

```
https://media.p1.pantheon.io/image/{siteId}/assets/{assetId}/{versionId}-{filename}?fit=cover&gravity=auto
```

Rich mode — a `MediaValue` object:

```jsonc
{
  "assetId": "…", "versionId": "…",
  "url": "https://media.p1.pantheon.io/image/{siteId}/assets/{assetId}/{versionId}-{filename}",
  "width": 1600, "height": 900,
  "alt": "A red barn at sunset",
  "metaSchemaVersion": 1
}
```

Legacy documents may still hold the old `{siteId}/{workstreamId}/media/{timestamp}-{filename}` URL form; the render helpers accept it (as a string) unchanged.

---

## For site developers enabling the media library

If you are building a P1-powered site and want editors to have a media library in the Puck sidebar, install this package and add the media plugin alongside the standard CCR editor setup. The values required by `createMediaPlugin` — site ID, workstream ID, and auth token — are all available from CCR context, so no additional configuration is needed beyond wiring them through.

### Install

```sh
pnpm add @pantheon-systems/p1-media-r2
```

### Integration with puck-css

Pass the media plugin via `additionalPlugins` in `useP1Editor`. The hook handles stable plugin merging internally — no manual override wiring needed.

```tsx
import { useMemo } from "react";
import { Puck } from "@puckeditor/core";
import { createMediaPlugin } from "@pantheon-systems/p1-media-r2";
import { useP1Editor, useP1Auth } from "@pantheon-systems/puck-css";

function Editor({ siteId, workstreamId, documentPath, config }) {
  const { getToken } = useP1Auth();

  const mediaPlugin = useMemo(
    () =>
      createMediaPlugin({
        workerUrl: "https://staging.media.p1.pantheon.io",
        siteId,       // from CCR context
        workstreamId, // from CCR context
        getAuthToken: getToken, // from useP1Auth — always returns the current token
      }),
    [siteId, workstreamId, getToken],
  );

  const { loading, error, puckKey, puckProps } = useP1Editor({
    documentPath,
    puckConfig: config,
    additionalPlugins: [mediaPlugin],
  });

  if (loading) return null;
  if (error) return <div>Error: {error.message}</div>;
  return <Puck key={puckKey} {...puckProps} />;
}
```

### `createMediaPlugin` options

| Option | Type | Description |
|--------|------|-------------|
| `workerUrl` | `string` | Base URL of the deployed p1-media Worker |
| `siteId` | `string` | Site UUID — from CCR context |
| `workstreamId` | `string` | Workstream UUID — from CCR context. **Legacy:** still sent but the site-scoped worker ignores it |
| `getAuthToken` | `() => Promise<string \| null> \| string \| null` | Returns the CCR auth bearer token — pass `useP1Auth().getToken` directly |
| `fieldNamePatterns` | `RegExp[]` | Override the default field name patterns |
| `metadataFields` | `MetadataFieldDef[]` | Fallback metadata schema for the `p1-media` field when `GET /media/schema` is unavailable (defaults to `[{ name: "alt", label: "Alt text", type: "string" }]`) |

---

## Exports

```ts
import {
  createMediaPlugin,           // Plugin factory (for CCR integration)
  createMediaFigureBlock,      // Ready-made Puck component: p1-media field + MediaFigure render
  buildImageUrl,               // Apply transform params to a CDN URL string (basic mode)
  getMediaProps,               // (value, { mediaBaseUrl, transform }) -> { src, alt, width?, height? }
  MediaImage,                  // <img>-like component for a MediaValue
  MediaFigure,                 // figure + schema-driven caption/credit/byline
  makeMediaValue,              // build a MediaValue (enforces the assetId+versionId invariant)
  isMediaValue,                // narrow string | MediaValue
  DEFAULT_MEDIA_PATTERNS,      // default field-name patterns
} from "@pantheon-systems/p1-media-r2";

import type {
  MediaPluginOptions,          // createMediaPlugin config shape
  MediaFigureBlockOptions,     // createMediaFigureBlock config shape
  MediaFigureBlockProps,       // { photo: MediaFieldValue | null }
  ImageTransformParams,        // { width?, height?, format? (incl. "auto"), quality? }
  MediaValue,                  // rich field value: { assetId, versionId, url, alt?, ... }
  MediaFieldValue,             // string | MediaValue
  MediaProps,                  // getMediaProps return shape
  MetadataFieldDef,            // { name, label, type, required? }
  GetMediaPropsOptions,        // { mediaBaseUrl, transform? }
} from "@pantheon-systems/p1-media-r2";
```

The server-safe subset (`buildImageUrl`, `getMediaProps`, `MediaImage`, `MediaFigure`, `createMediaFigureBlock`, `makeMediaValue`, `isMediaValue`, and the types) is also exported from the package's `react-server` entry for use in RSC. The interactive cropper (`react-image-crop`) is bundled into the client entry with its styles injected at runtime — consumers install nothing extra.
