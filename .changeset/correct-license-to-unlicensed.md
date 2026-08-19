---
"@pantheon-systems/css-client": patch
"@pantheon-systems/puck-css": patch
"@pantheon-systems/create-p1-starter-kit": patch
"@pantheon-systems/p1-next-sdk": patch
"@pantheon-systems/p1-content-validator": patch
"@pantheon-systems/p1-ai-chat": patch
---

Set `license` to `UNLICENSED` to match the rest of the suite. These packages had drifted
to `MIT` (or had no `license` field at all), but they are closed-source and were never
intended to be published under an open-source license.
