---
"@pantheon-systems/css-client": minor
---

**[Breaking Change]** The `crdtState` field is removed from the `DocumentVersion` type.

### What Changed
- `DocumentVersion.crdtState` no longer exists. The API stopped returning this field some time ago (its backing storage was removed server-side), so the type was promising a `string | null` value that was always `undefined` at runtime.

### Migration / Action Required
Delete any reference to `version.crdtState` — code that read it was already receiving `undefined`, and object literals typed as `DocumentVersion` no longer need to supply it.

```ts
// Before
const version: DocumentVersion = { id, documentId, branchId, versionNumber, snapshot, crdtState: null, /* … */ };

// After
const version: DocumentVersion = { id, documentId, branchId, versionNumber, snapshot, /* … */ };
```
