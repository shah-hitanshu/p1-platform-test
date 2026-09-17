---
"@pantheon-systems/css-client": minor
---

**[Fix]** Stopping an editing agent now stops it. Previously the agent lost its
edit session, asked for another and carried on changing the page, while
`stopAgent` reported success.

### What Changed

- A stopped turn cannot write to the document again, whether or not the agent
  cooperates. A cooperating agent ends the turn as soon as it notices.
- Stop reports whether there was anything to stop, instead of always reporting
  success.
- An agent's presence names the turn it is working on, so a panel holding a turn of
  its own can tell whether a stop is aimed at that turn or at some other agent's.

### Migration / Action Required

`stopAgent` takes either an agent id, as before, or `{ turnId }` to stop one
specific turn. Existing calls are unaffected.

Its result is now `{ success: false, reason: 'no_active_turn' }` when no agent
was running, where it previously returned `success: true`. Anything asserting
on that shape needs updating; treat it as "nothing to do", not an error.

### Known limits

- A stop takes effect on the agent's next call to the backend, so an operation
  already in flight can still finish. What it cannot do is start another.
- Creating a page is the one such operation that is not itself refused; the turn
  ends at the agent's next edit instead.
- A stop applies to the page it was made from. A turn working across several
  pages is barred there, and ends when it next tries to write to that page.
