---
"@pantheon-systems/css-client": minor
---

Add `merging` to `MergeRequestStatus`: merge requests report this status while the merge job runner is executing them (PCC-3737). Existing statuses are unchanged; clients that switch exhaustively on the status union should handle the new value.
