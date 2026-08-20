---
"@pantheon-systems/puck-css": patch
---

**[Fix]** Page route resolution no longer drops to an empty page list — or hammers the backend with retries — when the document-list API has an outage.

### What Changed
- When refreshing its route key cache fails, the page store now keeps serving the last successful result instead of returning an empty list, so collection-template routes keep resolving during a backend brownout.
- After a failed refresh, no new document-list queries are issued for a 30-second cooldown, preventing render traffic from amplifying backend slowness into a sustained overload.
- Happy-path behavior is unchanged (same 30-second cache TTL and values).
