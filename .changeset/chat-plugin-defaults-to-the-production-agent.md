---
"@pantheon-systems/p1-ai-chat": minor
---

**[Feature]** `createAIChatPlugin()` no longer has to be told where the chat agent is — it reaches the production agent by default.

### What Changed

- `agentUrl` is optional, so `createAIChatPlugin()` now takes no required options at all.
- An `agentUrl` that is defined but empty or whitespace is treated as unset and falls back to the default, instead of being passed through as an unusable origin. An env file with a bare `NEXT_PUBLIC_AGENT_URL=` inlines to `""`, which is the case this covers.
- `PRODUCTION_AGENT_URL` and `resolveAgentUrl` are exported for callers that need to resolve the same value themselves.

### Migration / Action Required

None. A passed `agentUrl` still wins, so existing wiring keeps working unchanged; drop it only if you want the default.

Keep passing it for any editor aimed at a non-production environment. An editor pointed at a non-production backend but left silent here will now reach the production agent rather than hiding the panel, and nothing reports the mismatch.
