---
"@pantheon-systems/puck-css": patch
---

**[Fix]** The List block's sidebar (Title, Subtitle, Teaser, Image, Icon) now shows the auto-detected field mapping instead of always showing "None" when no field has been explicitly chosen. Previously the dropdown displayed "None" regardless of whether the mapping was unset (auto-detected) or explicitly cleared by the user, so re-selecting "None" after touching the dropdown silently broke a working auto-detected mapping.
