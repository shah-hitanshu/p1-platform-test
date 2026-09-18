---
"@pantheon-systems/css-client": patch
---

**[Fix]** Record upstream resolutions against the exact source version returned by the upstream diff.

### What Changed

- `setUpstreamResolutions` now sends `upstreamVersionId`, allowing resolution requests to pass CCR validation and preserve changes published after the review began.
