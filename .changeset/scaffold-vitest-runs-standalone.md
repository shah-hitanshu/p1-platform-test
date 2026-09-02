---
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** A scaffolded project's test suite now runs on its own. Its `vitest.config.ts` previously aliased three package specifiers to paths above the project directory, which resolve to nothing outside the repo the template is built from.

### What Changed

- `vitest.config.ts` no longer contains those aliases. Tests resolve `@pantheon-systems/puck-css` and `@pantheon-systems/pds-toolkit-react` from `node_modules` like any other dependency, so they exercise the published packages rather than stand-ins.
- Three list-block test files that depended on those aliases were withheld from the template and are now included. A fresh scaffold runs 29 test files instead of 26.

### Migration / Action Required

Projects scaffolded before this release carry the old config. Replace the `resolve.alias` block in `vitest.config.ts`:

```ts
// Before
resolve: {
  alias: {
    "@pantheon-systems/puck-css/fields": resolve(__dirname, "../..", "packages/puck-css/src/data/fields.tsx"),
    "@pantheon-systems/pds-toolkit-react": resolve(__dirname, "../..", "packages/puck-css/src/__mocks__/@pantheon-systems/pds-toolkit-react.ts"),
    "@puckeditor/core": resolve(__dirname, "../..", "packages/puck-css/src/__mocks__/@puckeditor/core.ts"),
  },
},

// After
test: {
  server: {
    deps: {
      inline: [/@pantheon-systems[/+]puck-css/, /@pantheon-systems[/+]pds-toolkit-react/],
    },
  },
},
```

`inline` is required: `pds-toolkit-react` imports its own stylesheet, and Node's ESM loader cannot load `.css`. Drop the now-unused `import { resolve } from "path"`.
