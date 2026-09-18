---
"@pantheon-systems/puck-css": minor
---

**[Feature]** Group source pages and translations in the locale switcher and make source-change review easier to follow and undo.

### What Changed

- The locale switcher marks the current page and shows "Needs review" for translations with outstanding source changes, including structural changes. Unavailable status checks are shown explicitly.
- Source changes use component and field names, and the current-value column follows live edits.
- Replacing translated content with source wording can be rolled back after reopening the drawer, while later edits are protected from rollback.
- Review actions use design-system buttons, and change counts describe the source comparison rather than a version-number difference.
- Structural changes no longer trigger "Needs review" or inflate its actionable count
- Reconciled changes identify the exact source version shown, matching the CCR resolution API.
