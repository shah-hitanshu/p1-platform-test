# @pantheon-systems/p1-content-validator

Validates Puck component edit operations against Pantheon's P1 component
registry, so writes that don't match a component's registered prop shape are rejected before
they reach a document.

> Part of Pantheon's **P1** platform. It is published publicly so P1 services can install it,
> but it validates against Pantheon's registry format and has no standalone use.

## Install

```bash
npm install @pantheon-systems/p1-content-validator
```

No peer dependencies.

## Usage

```ts
import { validateOps } from "@pantheon-systems/p1-content-validator";

const result = validateOps(ops, registry);
```

Operations are checked against the registry entry for each component — unknown components,
unknown props, and type mismatches are reported rather than silently written. This is the same
validation the backend applies to AI-assisted and API-driven edits.

Also exported:

- `validateDocumentStructure` — structural validation of a whole document
- `validateTranslationAuthority` — enforces which source may write translated content

## License

MIT
