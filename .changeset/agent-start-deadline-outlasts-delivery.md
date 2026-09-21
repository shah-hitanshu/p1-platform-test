---
"@pantheon-systems/puck-css": patch
---

**[Fix]** A comment thread no longer says a mentioned agent "did not respond" while that agent
is still on its way to answering.

### What Changed

- The thread now waits 10s, not 4s, before turning an agent's "working" line into a failure.
  4s did not cover the round trip — the agent is told about the mention, acknowledges it, reads
  the thread back, posts its reply, and only then does that reply reach the editor — so a
  slow-but-successful answer was reported as a failure before it arrived.
- The deadline and the backend's 5s delivery timeout are now documented against each other on
  both sides, including the part the delivery timeout does not cover, so the next change to
  either one surfaces the constraint between them.
