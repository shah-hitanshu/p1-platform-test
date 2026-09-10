---
"@pantheon-systems/p1-ai-chat": minor
---

**[Feature]** Files you attach to the chat are kept, so a conversation you come back to can still open them — and an image you attached can be added to your media library.

### What Changed
- Reopen a conversation and its file cards open as they did when you sent them, instead of showing a name with nothing behind it.
- Image cards in a reopened conversation show the picture again rather than a filename and a badge, and a long transcript costs nothing to load.
- An image you attached can be added to the media library from its preview. That is the only way one becomes a site asset — nothing you attach to a conversation is published on its own. Briefs are not offered.
- Adding an image asks for the same details the library's own upload asks for, alt text included, and saves them with the image rather than leaving it in the picker unlabelled.
- Deleting an image from the media library does not take it out of the conversation that sent it. The file stays where you sent it, and its preview offers to add it back; doing so keeps the details it already had, so a field you leave blank is not cleared.
- Clearing a conversation drops its files with it — except the ones you added to the library, which stay yours. They stop being reachable at once; the media service's retention pass removes the stored copies.
- Sending is never held up by keeping a file. If storage is slow or unreachable the turn goes anyway, losing only the ability to reopen the file later. What is kept is the file you attached, not the shortened text or shrunk image the agent reads.
- Turns you sent before this release keep showing their cards greyed out.

### Migration / Action Required

Nothing to change in your editor code. Attachments are kept once `NEXT_PUBLIC_MEDIA_WORKER_URL`
points at your media host — the same variable the media picker reads, so the two cannot end up
in different environments.

Leave it unset and attachments keep working as they do today — they just do not outlive the tab,
and nothing can be added to the library. There is no production default for chat on purpose: a
wrong host would put people's files somewhere they did not choose, and silence is the safer
failure.

`createAIChatPlugin` still accepts a `mediaWorkerUrl` option, which wins over the variable when
both are set.
