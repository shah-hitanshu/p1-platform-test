+---
description: Automatically run this skill when completing a user-facing feature, bug fix, or breaking API change to generate a .changeset versioning file for package releases.
globs: .changeset/*.md
---

# Skill: Writing Customer-Focused Changesets

When generating or editing a Changeset file (for `@changesets/cli`), your goal is **not** to summarize code diffs, but to inform **package consumers** about what changed, why it matters to them, and how to adapt to the changes.

---

## Core Rules

1. **Write for Consumers, Not Maintainers**
   * ❌ *Bad:* "Refactored `useAuth` hook to use `useSyncExternalStore` instead of `useEffect`."
   * ✅ *Good:* "Fixed a rare issue where user authentication state could briefly desynchronize across browser tabs."

2. **Categorize the Change Clearly**
   Every entry must start with a bolded structural classification:
   * **[Breaking Change]** – Requires code changes from the consumer.
   * **[Feature]** – New functionality added without breaking existing behavior.
   * **[Fix]** – Corrected bug or unexpected behavior.
   * **[Performance]** – Improved speed, memory, or bundle size.
   * **[Deprecation]** – Feature is marked deprecated for removal in a future major version.

3. **Follow Semantic Versioning Impact**
   * **Major (`major`)**: Incompatible API changes, removals, default behavior changes.
   * **Minor (`minor`)**: Backward-compatible new features or capabilities.
   * **Patch (`patch`)**: Backward-compatible bug fixes or minor performance tweaks.

---

## Anatomy of a Great Changeset Description

Structure every non-trivial changeset using these three sections:

```markdown
---
"package-name": patch
---

**[Fix]** Brief, high-level summary of the visible impact (1 sentence).

### What Changed
Describe the context and what actually changes for the end-user. Avoid internal implementation details unless relevant for debugging or migration.

### Migration / Action Required
*(Omit if patch or transparent fix)*
Provide clear code snippets showing **Before** and **After**, or explicit steps the consumer needs to take.