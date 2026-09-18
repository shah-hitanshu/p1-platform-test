---
"@pantheon-systems/p1-next-sdk": patch
---

**[Feature]** Experimental features can be answered locally during development, so a feature can be worked on before its rollout flag exists.

### What Changed

- `NEXT_PUBLIC_P1_FLAG_OVERRIDES` answers experimental feature flags in the browser: a comma-separated list of flag keys turns each of them on, and a JSON object of flag key to boolean can also force one off. An override wins over the rollout service, and when it answers for every flag no rollout client is initialized at all.
- The variable is read only outside a production build, so it is absent from a production bundle and cannot turn a feature on for a deployed site.
