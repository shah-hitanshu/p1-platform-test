---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The editor's block drawer now renders correctly in projects that don't use Tailwind CSS.

### What Changed

- The block-drawer rows were styled with Tailwind utility classes while this package declares no Tailwind dependency. They only rendered because the scaffold's stylesheet extended Tailwind's scan into this package, so a project that removed Tailwind lost layout inside the editor itself — icons and labels stacked instead of sitting on one row.
- Every component here now ships its own styles, so nothing in this package depends on the consumer's Tailwind build.

### Migration / Action Required

None. Projects scaffolded from the starter kit can now remove the
`@source "../node_modules/@pantheon-systems/puck-css/dist";` line from
`app/styles.css`; new scaffolds no longer include it.
