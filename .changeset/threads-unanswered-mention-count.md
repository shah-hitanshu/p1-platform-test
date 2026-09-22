---
'@pantheon-systems/css-client': minor
'@pantheon-systems/puck-css': minor
---

**[Feature]** Count the mentions an agent never answers.

### What Changed

- A thread that tells its reader a mentioned agent did not respond now reports that
  once, so the share of mentions that go unanswered can be measured instead of guessed
  at. Each report carries the thread, the comment that did the mentioning, the agent and
  how long the reader waited — no comment text and nothing a user typed.
- `threads.reportUnansweredMention(siteId, threadId, report)` on the client, for a host
  that renders its own thread view and wants the same signal. Viewing the thread is
  enough permission, since a read-only reader sees the same line.

### Migration / Action Required

None. Hosts using the built-in thread UI get this without changes.
