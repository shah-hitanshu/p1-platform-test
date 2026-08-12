---
"@pantheon-systems/puck-css": patch
"@pantheon-systems/p1-next-sdk": patch
---

Fixes template datasources, which could not resolve end to end. Three separate faults sat on the same path: `getEditorContext` ran outside the request auth context, so lazy branch resolution never completed and both the template datasource list and the route list came back empty; `extractReferencedDatasourceIds` and `resolveSourcePath` both used `\w`, which excludes the hyphen, so the kebab-case query names behind every `templates.<name>` id failed to match a fetcher and were then read as subtraction by the expression evaluator.

A failed CSS query lookup in the editor context now warns instead of being swallowed, so an empty datasource dropdown is diagnosable.
