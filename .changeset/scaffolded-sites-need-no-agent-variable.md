---
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Feature]** `NEXT_PUBLIC_AGENT_URL` is gone from the list of environment variables a new site has to set. The AI chatbot now finds the chat agent on its own.

### Migration / Action Required

None. Sites that already set it keep working — the value is still honoured as an override for a site pointed at a non-production environment.
