---
"@pantheon-systems/create-p1-starter-kit": patch
---

**[Fix]** The AI chatbot now appears for everyone it has been turned on for. Some accounts were enabled but never saw the chat panel in the editor.

### What Changed
- The editor now identifies the signed-in user by their account email when checking whether the chatbot is available to them. Accounts that had been given access but saw no chat panel get it on their next editor load.
- Nothing to configure: update the scaffold and redeploy.
