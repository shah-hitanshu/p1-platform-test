---
'@pantheon-systems/create-p1-starter-kit': patch
---

Fix unreadable sign-in and welcome screens on dark-themed sites. Both screens set a dark
foreground but no background of their own, so on a site whose `body` is dark — including one
that follows the visitor's OS dark mode — they rendered dark text on a dark background. They
now establish their own background alongside the foreground, from a single shared surface
definition the two screens have in common.
