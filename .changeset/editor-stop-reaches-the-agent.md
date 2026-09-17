---
"@pantheon-systems/puck-css": minor
---

**[Fix]** The editor's Stop now stops the agent. Previously it only took the
page back, so the agent asked for it again and carried on editing while the
button reported success.

### What Changed

- Stop reaches an agent this browser tab has no connection to, so stopping
  someone else's agent works the same as stopping your own.
- Stop reports whether there was anything to stop, instead of always reporting
  success.

### Migration / Action Required

The editor context gains `registerAgentCancel`, for a panel holding its own live
connection to an agent to contribute a cancel of its own. The registered
function is called with what is being stopped — an `ActorPresence`, or
`{ turnId }` — and decides for itself whether that is the turn it holds, since
every stop on the page reaches it. `stopAgent` accepts `{ turnId }` alongside an
agent id; existing calls are unaffected.

### Known limits

- A stop takes effect on the agent's next call to the backend, so an operation
  already in flight can still finish. What it cannot do is start another.
- Creating a page is the one such operation that is not itself refused; the turn
  ends at the agent's next edit instead.
- A stop applies to the page it was made from. A turn working across several
  pages is barred there, and ends when it next tries to write to that page.
