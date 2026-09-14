---
"@pantheon-systems/puck-css": minor
"@pantheon-systems/css-client": minor
---

**[Feature]** Reconciling an upstream change on a translation now sticks.

### What Changed

- Dealing with a reported change on a translated page is recorded, so it stops being reported. Taking the source value, and dismissing an advisory change, both count as dealing with it.
- Each reported change is settled on its own, so taking one change to a field leaves the other changes to that field on the list.
- Seeding a draft for a change that needs translation no longer settles it: the field holds the source wording and still wants translating, so it stays listed until it is marked done.
- Progress survives a reload, so a translation can be worked through over several sittings.
- A field the source page changes again is reported once more, without anyone having to clear anything.
- The panel says how many changes have already been reconciled alongside the version range it is reporting over.
- Reconciling is recorded against the branch it happened on, so settling a change on one branch leaves the others reporting it.
- Settling records the version the reconciler was shown rather than whatever the source page has reached since, so a change made while they worked stays on the list.
- The client exposes reading, recording, and clearing these per-change resolutions, several at once, and can ask for the reconciled changes as well as the outstanding ones.

A change that could not be recorded stays on the list and says so, rather than disappearing as though it had been handled. Settling several changes at once either records all of them or none, so a batch never lands in part. Only a component the source page still holds can be reconciled, though a record left behind by one that has gone can still be cleared.
