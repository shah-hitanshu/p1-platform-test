---
'@pantheon-systems/create-p1-starter-kit': minor
---

Add non-interactive scaffolding: `--yes`/`-y` accepts defaults for every prompt, and
`--pm <pnpm|npm|yarn>`, `--git`/`--no-git`, `--install`/`--no-install` answer individual
prompts directly. CI uses this to scaffold and validate a generated project on every PR.
