---
"@pantheon-systems/create-p1-starter-kit": patch
---

Fix the Tailwind `@source` path in the starter template so scaffolded projects pick up puck-css component styles. The path was monorepo-relative and did not exist in a scaffold, so every Tailwind utility used inside puck-css (data-list built-in components, editor chrome) rendered unstyled. It now points at `node_modules/@pantheon-systems/puck-css/dist`, which resolves in both the monorepo and a scaffolded project.
