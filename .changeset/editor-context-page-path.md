---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The editor no longer loses its data-source registry and route list on every page it opens. A document identifies its page by slug, so reading the open document's path gave the editor `blog` where its own APIs require the page path `/blog` — `/p1/api/editor-context` and `/p1/api/datasources` answered `400 invalid_path` for every page except the site root.

### What Changed

- `useLiveEditorContext` (and `useLiveRemoteDatasources`, which reads through it) now roots the path it queries with, so `{{ source.field }}` resolution in the canvas, the data-source explorer, and the field-connect sidebar see live data again.
- The `path` these hooks return is rooted for the same reason — saving or removing a page-scoped data source posts it back to the API, and those requests were failing too.
- Sites whose document paths already carry a leading slash are unaffected.
