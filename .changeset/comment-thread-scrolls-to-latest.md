---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The comment thread panel now scrolls to keep the latest message visible.

### What Changed
- Opening a thread now starts scrolled to its most recent comment instead of the top.
- Posting a new comment, or an @mentioned agent's reply landing in an open thread, now smooth-scrolls that new comment into view instead of leaving it off-screen below the fold.
