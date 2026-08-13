---
name: changesets
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

   Tightening a **peer range** breaks installs without changing any API. Put the new requirement in the summary line as a trailing parenthetical, not only under Migration — it decides whether the upgrade resolves at all.

4. **Cut Rationale, Not Detail**
   Changelogs are scanned, so length is not the measure — what earns its place is. Keep anything that
   tells a reader whether they were affected, what they will notice, or what to do; a fix's root
   cause usually qualifies. Cut how the feature reasons internally, the rules governing its edge
   cases, and the history of the bug.

5. **One Changeset Per Package**
   The body is copied **verbatim into every package** listed in the frontmatter, so a combined entry puts each package's prose in the other's changelog. List two packages only when the same sentence is true of both.

   The package boundary always wins, because it is mechanical. Within one package, prefer a single
   entry; split only when the two changes have different audiences or different required actions.
   Never split to make each half shorter — a requirement that gates the upgrade then sits in
   whichever half you happened to choose, where half your readers will not see it.

---

## Anatomy of a Great Changeset Description

Structure every non-trivial changeset using these three sections:

```markdown
---
"package-name": patch
---

**[Fix]** One sentence: the visible impact, plus a trailing parenthetical if some requirement
gates the upgrade.

### What Changed
<!-- One bullet or short paragraph per user-visible change. A reader who skims only the openings
     should know what they will notice. -->
- 

### Migration / Action Required
*(Include whenever the consumer must do something — a new peer requirement counts, even on a
minor. Omit only when nothing is required of them.)*
Provide clear code snippets showing **Before** and **After**, or explicit steps the consumer needs to take.
```

---

## In this repo

* `puck-css`, `css-client`, `p1-next-sdk` and `create-p1-starter-kit` are a `fixed` group in `.changeset/config.json`. A bump to any one of them releases all four, and the highest pending bump wins — a patch entry can ship as a minor.
* Private packages, including everything in `workers/`, are never released and take no changeset. `changeset status --since=main` reports an error when only a private package changed; that is expected, and no CI job gates on it.
* Confirm an entry parses and resolves to the bump you intended: `npx changeset status`.
* `wc -w .changeset/your-entry.md` if an entry feels long. There is no limit to hit; the question is
  whether the extra words are things a consumer needs or an explanation of the implementation.
