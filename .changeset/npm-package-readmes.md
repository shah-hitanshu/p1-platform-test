---
"@pantheon-systems/create-p1-starter-kit": patch
"@pantheon-systems/p1-content-validator": patch
"@pantheon-systems/css-client": patch
"@pantheon-systems/p1-next-sdk": patch
"@pantheon-systems/p1-ai-chat": patch
"@pantheon-systems/puck-css": patch
"@pantheon-systems/p1-media": patch
---

Adds a README to every published package. Each one rendered a blank page on npmjs.com, because
no `README.md` existed in the package directory to be included in the tarball — npm renders the
README from the published tarball, not from the source repository, so a private repo was never
the cause.

Also repoints every `repository` URL at `pantheon-systems/p1-platform` with the correct
`directory`. They still referenced the pre-merge repositories (`puck-css-integration`,
`collaborative-state-system`, `p1-media-r2`), so the "Repository" link on each npm page went
nowhere. Adds a matching `homepage` for each package.

No runtime code changes.
