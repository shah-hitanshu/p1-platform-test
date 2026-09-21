---
"@pantheon-systems/p1-ai-chat": minor
---

**[Feature]** Ask Zappy to add an image you attached to the chat, and it goes into the site's
media library.

### What Changed

- Zappy confirms the alt text with you before adding an image, and the transcript shows the step
  under the file's name. Images attached earlier in the conversation still count, not just the
  ones on the current turn.
- Two attachments sharing a filename no longer collide: the second is named `photo-2.png` in the
  composer, in the library, and in what Zappy is told, so it can act on the one you meant.
- An attachment stays usable when the media service is slow. Only sending the bytes is bounded at
  three seconds; the small call that records them is now waited out in full, where before it could
  be cut off and lose the image for the rest of the conversation.
