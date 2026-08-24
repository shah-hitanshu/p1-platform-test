---
'@pantheon-systems/css-client': minor
'@pantheon-systems/puck-css': minor
---

Stop sending the full local Yjs history on every WebSocket connect. On first connect
the client sends no state vector; the server responds with its full current state and
a baseline verdict. On reconnects the client sends only the delta the server is
missing. When the server reports the client's lineage has diverged (code 4002), the
client fetches fresh content from REST and reconnects with a new Y.Doc — bypassing the
union-merge admission path that could otherwise resurrect pre-merge content.
