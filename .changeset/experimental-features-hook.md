---
"@pantheon-systems/p1-next-sdk": minor
---

**[Feature]** New `useP1ExperimentalFeatures` hook, so an application can ask whether a Pantheon feature that is still rolling out is available to the person and site in front of it.

### What Changed

- `useP1ExperimentalFeatures({ userId, siteId })` returns `isEnabled(feature)` and `resolved`. `userId` may be null — while nobody is signed in, or before auth has answered, every feature reads as off.
- Availability is resolved once per user-and-site per page load and shared by every caller, so a page with many callers makes one rollout check rather than one each. Nothing polls, and a change to a rollout reaches a reader on their next page load.
- Everything reads as off until the check answers, and stays off if it cannot be reached, so an unfinished feature never flashes into view.
- `siteId` is optional; without it, availability is decided for the person alone.
- `NEXT_PUBLIC_LD_CLIENT_ID` set to an empty string opts a deployment out of rollout checks entirely, which leaves every experimental feature off.

### Migration / Action Required

None. Nothing existing changes behaviour.
