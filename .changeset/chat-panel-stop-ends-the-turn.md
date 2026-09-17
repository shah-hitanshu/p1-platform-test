---
"@pantheon-systems/p1-ai-chat": patch
---

**[Fix]** The chat panel's Stop now ends the agent's turn, not just the panel's
view of it. It previously stopped the turn only in the browser, so with the
connection down it said "Stopped" while the agent kept working.

### What Changed

- Stopping from the panel and stopping from the page are the same operation, so
  they behave identically.
- A stopped turn still reads as stopped after a reload, and the step it
  interrupted still reads as unfinished. Both were dropped when the conversation
  was replayed, so a reopened panel showed the interrupted step as having
  completed.
