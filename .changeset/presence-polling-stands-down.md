---
"@pantheon-systems/puck-css": patch
---

**[Fix]** Presence polling now stands down when it has nothing to do.

### What Changed
- `P1PuckProvider` stops polling `GET /branches/{id}/presence` once realtime presence updates are arriving. Previously the request kept firing every 5 seconds for the life of the editor session even with a live connection.
- Polling also pauses while the browser tab is hidden, and issues a single refresh when the tab becomes visible again.
- When a realtime connection drops, the presence list keeps the actors that connection last reported and is refreshed immediately, so it no longer briefly shows whoever was present the last time polling ran.
- `presencePollingInterval` now defaults to `10000` (was `5000`), matching the presence hooks. Pass the prop to keep the old cadence.
- `onPresenceChange` now fires for realtime presence changes as well as polled ones, instead of going quiet whenever a realtime connection was active.
