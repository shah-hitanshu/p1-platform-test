---
"@pantheon-systems/css-client": minor
"@pantheon-systems/puck-css": patch
---

Merge job runner support (PCC-3737): `merge.executeRequest` responses may now carry the async job shape (`jobId`, `status`, counters, `statusUrl`) when a merge outlives the server's bounded wait; new `merge.getJob` and `merge.waitForJob` poll it to a terminal state. The editor's merge-resolution flow polls long-running merges to completion instead of misreading the accepted response as success.
