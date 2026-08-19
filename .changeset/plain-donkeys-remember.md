---
"@pantheon-systems/create-p1-starter-kit": patch
---

Stamp `p1.templateVersion` into a scaffolded project's `package.json`, recording the version of `create-p1-starter-kit` that generated it. Previously a scaffold carried no record of its origin, so the only way to infer its generation was reading the pinned dependency versions. The field is the anchor future migration tooling needs to know a project's starting point.
