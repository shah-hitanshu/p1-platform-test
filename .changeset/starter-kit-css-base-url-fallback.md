---
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** A freshly scaffolded project now connects to the production CCR backend by default instead of failing to connect at all.

### What Changed
- The scaffolded `middleware.ts` and the editor widget's logout handler no longer hardcode `http://localhost:8787` as their fallback when `NEXT_PUBLIC_CSS_BASE_URL` is unset. They now fall back to the SDK's production base URL, matching every other config path in the template.
