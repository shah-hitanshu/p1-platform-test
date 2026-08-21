---
"@pantheon-systems/css-client": patch
---

Carry the HTTP status on `AuthenticationError` for 401 responses, so callers reporting "request X failed (status)" can name the status for a rejected session the same way they can for other API errors. Stays optional: the error is also thrown when no token could be obtained locally, where there is no response and no status.
