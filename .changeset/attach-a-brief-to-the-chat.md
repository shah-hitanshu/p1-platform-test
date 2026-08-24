---
"@pantheon-systems/p1-ai-chat": minor
---

**[Feature]** The chat panel now takes files: drop, paste or pick a brief or an image and it goes to the agent with your next message.

### What Changed
- Attach a file by dropping it anywhere on the panel, pasting it, or picking it with the button beside Send. Up to four files per turn.
- A document's text goes to the agent as what you are asking for. `.md`, `.txt`, `.csv` and anything `text/*` are read directly, and an `.html` page is read as the text it says rather than as its markup.
- An image goes to the agent for it to look at, so you can ask what is wrong with a layout or what a design does. PNG, JPEG, GIF, WebP or AVIF. Nothing is uploaded and no file is kept, so an attached image is not on your site and cannot be placed on a page — add it to the media library for that.
- Attached files show above the message box as cards: an image as itself, a document by name and kind. Open one to see exactly what will go to the agent, or take it off before you send.
- Anything else is refused on the composer with a sentence saying why, and the turn will not send until you deal with it, so a message never quietly goes without the file you attached. PDF and Word ask you to export to `.md` or paste the text in.
- The transcript shows a turn's files as cards rather than pasting a brief in as though you had typed it. Only the names are kept, so reopening the conversation later shows what each turn carried without being able to open it again.
- Attaching files needs an up-to-date chat agent behind your `agentUrl`. Against an older one the cards still appear, and the reply simply will not have been given them.
- Where the agent runs a model that cannot be shown images, it tells you it has not seen the image and asks you to describe it, rather than describing something it was never given.
