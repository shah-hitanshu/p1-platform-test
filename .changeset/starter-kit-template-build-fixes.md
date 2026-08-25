---
'@pantheon-systems/create-p1-starter-kit': patch
---

Fix four defects in the generated template:

- The scaffolded `eslint.config.js` now includes the shared `tests` preset, so test files get
  the test-file rule relaxations instead of being linted as source. The preset list is read from
  the starter app's own config, and the build fails loudly if a preset cannot be inlined.
- Scaffolded projects ship a working `.gitignore`. npm strips files named `.gitignore` from
  published tarballs, so the template now carries it undotted and the CLI restores the name
  before the initial commit — previously the first commit could include `node_modules` and `.env`.
- Scaffolds ship a README written for them, and no longer ship the monorepo's `CHANGELOG.md`.
- Scaffolds no longer ship `tsconfig.tsbuildinfo` or `next-env.d.ts`. Both are generated
  build artifacts, gitignored in the source app; the tsbuildinfo was a 466KB incremental
  cache keyed to paths inside the monorepo that produced it.
