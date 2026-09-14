---
"@pantheon-systems/puck-css": minor
---

**[Feature]** A translated page can now see what changed on the page it came from.

### What Changed

- The editor toolbar carries how far behind its source a translated page is, beside the locale it belongs to. It appears only while there are changes to deal with, so a page that is up to date is not asked about.
- Opening it lists what changed on the page the document derives from since it last synced, grouped by what each change means, against the versions being compared. An inherited change can be applied outright, one needing translation can seed a draft to work from, and an advisory one can be dismissed.
- Each change sets the source value beside this page's, so the two can be read together.
- A value is marked with the language it is written in, so text in a right-to-left or non-Latin script is laid out and read as that language rather than as the page around it.
- Applying a change is an ordinary edit: it rides the page's normal autosave and can be undone like any other.

Changes are grouped by who owns the value, so a field the market owns reads as advisory rather than as work outstanding.
