---
'@pantheon-systems/puck-css': patch
---

Inspector field labels no longer carry a field-type icon. Every field was prefixed with an
icon representing its input type (text, number, select), which added visual noise without
telling an editor anything the input itself didn't already show. Labels are now text only.
