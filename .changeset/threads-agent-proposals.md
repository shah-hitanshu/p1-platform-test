---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/css-client": minor
---

**[Feature]** An agent mentioned in a comment thread now shows its work in the thread: a working line while it reads the page, then a comment or a proposal of page edits that a reader can accept, dismiss, or refine.

### What Changed

- A comment now carries a `kind`: a plain `message`, an `agent_activity` line (`working` or `failed`, naming whose request it is on), or an `agent_proposal` with a summary and the proposed operations. `isAgentProposal` and `isAgentWorking` narrow a comment to those shapes.
- A proposal renders as a card with the summary, the number of changes, `Accept` and `Dismiss`, and a refine comment that posts back to the agent. Once decided, the card says who accepted or dismissed it.
- Accepting sends one request; the service puts the edits into the page as the person accepting, so the change reaches this editor and every other open one the way any edit does. A proposal the page refuses stays undecided and the refusal is reported.
- While the edits go in, the proposal's `status` is `applying`. A second accept arriving in that window, a retry of one whose acceptance was never recorded, and an agent rewriting the proposal are refused, so the edits cannot land twice. A claim an accept never finished is taken over after a minute.
- A proposal's operations must address the page data (`content`, `root` or `zones`); one aimed anywhere else is rejected when it is posted.
- The thread shows an agent as working the moment a comment mentions it, and reports that it did not respond if no comment arrives within a few seconds.
- `decideProposal(siteId, threadId, commentId, decision)` and `updateComment` are added to the threads client, and `postComment` accepts a structured `CommentContent` as well as a string. A `comment_updated` event replaces a comment already shown in the open thread.
- `useProposalDecision({ threadId })` and `ProposalCard` are exported for a host rendering its own thread panel.

### Migration / Action Required

None. Existing comments are `message` kind and render as before.
