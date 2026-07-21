# PROPOSAL-011: Content Localization and Translation

**Status:** Draft  
**Date:** 2026-05-19  
**Author:** Chris Yates (with Claude)  
**Jira:** [PCC-3239](https://getpantheon.atlassian.net/browse/PCC-3239) · related to [PCC-3225](https://getpantheon.atlassian.net/browse/PCC-3225) · under epic [PCC-3217](https://getpantheon.atlassian.net/browse/PCC-3217)  
**Depends on:** [PROPOSAL-010](./PROPOSAL-010-content-types-and-template-migration.md) (Content Types and Template Migration)  
**Affects:**
- CSS backend — new columns on `documents`, new locale diff API endpoint
- MCP server / agent worker — locale-aware document creation and editing
- Content validator library — locale ownership enforcement
- Puck editor integration — locale diff visualization surface

---

## TL;DR

Add a localization layer to CSS that links translated documents to their canonical originals, detects drift when canonical content evolves, and exposes the classified diff to external localization agents that work on branches. CSS is a coordination layer only — it detects what changed, classifies its impact, and provides the infrastructure for agents to do the translation work and humans to review it. It does not mediate external translation workflows or call external services.

---

## Background

Sites serving multilingual audiences need translated and localized versions of their content. Today CSS has no concept of locale or of the relationship between a canonical document and its translations. Each locale would need to be maintained as a completely independent document with no tooling to detect when the source has evolved.

This proposal adds that coordination layer, reusing the version tracking, action log, and branch-based review infrastructure introduced in PROPOSAL-010.

**Scope note:** URL routing for locale variants (e.g. `france.site.com/blog/my-post`) is handled at the edge/CDN layer. CSS stores documents with a `locale` field and is routing-agnostic. The edge decides which locale document to serve; CSS does not manage domain-to-locale mappings.

---

## Design Decisions

The following decisions were established during design review:

### 1. Locale ownership is declared on the template (per component, per prop)

Each prop on each component in a `TemplateSnapshot` carries a `localeOwnership` flag:
- `canonical` — translations inherit this value from the canonical; when the canonical updates it, translations receive the update
- `locale` — each locale manages this value independently; canonical changes to this prop are not propagated

This aligns with the existing AI instruction metadata already present at the component and prop level in the template format.

### 2. Pinned components enforce structural parity; unpinned slots are locale-composable

Translations must preserve all pinned components from the template (same constraint as any other template-conforming document). Non-pinned components are locale-composable — translators may add, remove, or reorder them for their locale. This is enforceable with `validateDocumentStructure` (see PROPOSAL-010 §9).

### 3. Branch model resolves change authority

When canonical content evolves, a localization agent works on a branch — not directly on the live translated document. The translated document on the branch is the agent's working copy. A human reviewer compares the branch against main using the existing merge preview tooling before approving the merge. No "who wins" logic is needed at the data layer; the branch and merge workflow handles it.

### 4. Locale is a document-level property

A single CSS site contains documents in multiple locales. A canonical English document and its French translation both live on the same site, linked by `canonical_document_id`. There are no separate per-locale sites. URL routing to locale-specific documents is handled at the edge.

### 5. CSS is a coordination layer only

CSS detects drift (canonical has advanced past a translation's last synced version), classifies the type of change (structural vs. prop-level, canonical-inherited vs. locale-managed), and exposes this via the locale diff API. External agents consume the diff, produce translations using whatever tools they have, and write results back via the standard edit session API on a branch. CSS does not call translation services or orchestrate agent workflows.

---

## Data Model

### New columns on `documents`

```sql
ALTER TABLE app.documents
  ADD COLUMN locale               TEXT,    -- e.g. 'en-US', 'fr-FR', 'es-US'
  ADD COLUMN canonical_document_id UUID    REFERENCES app.documents(id),
  ADD COLUMN canonical_synced_version INTEGER;
```

The `locale` and `canonical_document_id` fields are independent. Three document types emerge:

| Type | `locale` | `canonical_document_id` | Description |
|---|---|---|---|
| Canonical | `en-US` (or null) | null | Source document; other locales translate from this |
| Localized variant | `fr-FR` | `<canonical doc id>` | Translation of a canonical document |
| Locale-native | `fr-CA` | null | Content that exists only in this locale; has no canonical counterpart |

Locale-native content is first-class. A Quebec-specific regulatory page, for example, has `locale = 'fr-CA'` and no `canonical_document_id`. It is not a translation of anything — it simply exists in that locale only. The drift detection system ignores locale-native documents; there is nothing to sync them against.

`canonical_synced_version` tracks which version of the canonical this localized variant was last synchronized from — the same pattern as `template_version` in PROPOSAL-010. It is null for canonical and locale-native documents.

```sql
-- Efficient enumeration of translations that are behind
CREATE INDEX idx_documents_locale_sync
  ON app.documents(canonical_document_id, canonical_synced_version)
  WHERE canonical_document_id IS NOT NULL;
```

### Template `localeOwnership` extension

The `TemplateComponent` and field types in `TemplateSnapshot` (PROPOSAL-010) gain a `localeOwnership` field:

```ts
export interface TemplateComponentProp {
  name: string;
  localeOwnership: 'canonical' | 'locale';
}

export interface TemplateComponent {
  type: string;
  pinned: boolean;
  defaultProps: Record<string, unknown>;
  props?: TemplateComponentProp[];  // per-prop ownership; defaults to 'canonical' if absent
}
```

A prop without an explicit entry defaults to `canonical` — most props are canonical-inherited unless explicitly declared locale-managed.

---

## Localization Scenarios

### Scenario 1 — Text-only translation

The canonical changes a prop value (e.g., `HeroBlock.title`). The RFC 6902 patch on that version touches only paths under `/content/N/props/`. The locale diff API surfaces the changed paths with `ownership: 'canonical'` and `status: 'needs-translation'`. The localization agent reads the diff, produces translated values, and writes them to the translation document on a branch via the standard edit session.

This is the most automatable scenario: the diff is unambiguous, the target paths in the translation are identical to the canonical, and the change is scoped to prop values.

### Scenario 2 — Property localization

Some props are locale-specific by design (currency, date format, regional imagery, regulatory copy). The template declares these as `localeOwnership: 'locale'`. When the canonical changes a locale-managed prop, the locale diff API surfaces it with `status: 'locale-override'` — informational, not actionable. The translator's existing value is preserved. The agent reviews locale-managed prop changes on the canonical for cultural relevance but is not required to update the translation.

### Scenario 3 — Composition localization

The locale-specific document has different non-pinned components from the canonical — additional regional content, omitted components that don't apply, different ordering of editorial blocks. Pinned components are always present (template enforcement); the unpinned slots are the locale's own composition. When the canonical adds or removes a non-pinned component, the locale diff API surfaces this as a structural suggestion. The agent decides whether to mirror it in the translation.

Structural changes to pinned components (template migration path) propagate to all locales automatically via the migration job defined in PROPOSAL-010 — localized documents are template-conforming documents and participate in migration the same way as canonical documents.

---

## Agent Workflow

One branch is opened per localization run — not per document. All out-of-sync translations for a given locale (or all locales) are batched onto a single branch so that the human reviewer sees and approves the full set of changes together before anything merges.

```
Canonical document(s) advance on main
  │
  ▼
Drift detector queries all out-of-sync translations:
  SELECT d.id, d.locale, d.canonical_synced_version, d.canonical_document_id
  FROM app.documents d
  WHERE d.canonical_document_id IS NOT NULL
    AND d.canonical_synced_version < (
      SELECT MAX(version_number) FROM app.document_versions
      WHERE document_id = d.canonical_document_id AND is_latest = true
    )
  -- optionally filtered by locale: AND d.locale = $locale
  │
  ▼
Localization agent opens ONE branch for this run
  │
  ▼
For each out-of-sync translation (batched on the same branch):
  → Fetches locale diff (canonical current vs. translation current)
  → For canonical-inherited props that changed: translates values, writes to translation doc on branch
  → For structural changes on non-pinned components: mirrors or adapts as appropriate
  │
  ▼
Branch ready for review (covers all updated translations in this run)
  │
  ▼
Human reviewer:
  → Views locale diff per document (canonical vs. translation) — what the agent produced
  → Views branch diff per document (translation branch vs. translation on main) — what changed
  → Approves or requests changes on individual documents within the branch
  │
  ▼
Branch merged → canonical_synced_version updated for all translated documents in the batch
```

The localization agent is a standard CSS writer — it uses the existing edit session API (`start_edit_session`, `apply_document_edits`, `complete_edit_session`) and goes through the standard validation stack (content validator, structural conformance check). No special agent permissions or bypass are needed.

---

## Locale Diff API

New endpoint:

```
GET /api/sites/{siteId}/branches/{branchId}/documents/{encodedPath}/locale-diff
```

Returns the classified diff between a translation document's current snapshot and its canonical's current snapshot on the same branch. Used by both the localization agent (to know what to translate) and the review UI (to show the human what differs).

Response shape:

```ts
interface LocaleDiffResponse {
  canonical: {
    documentId: string;
    locale: string;
    version: number;
    path: string;
  };
  translation: {
    documentId: string;
    locale: string;
    version: number;
    canonicalSyncedVersion: number;
    path: string;
  };
  syncStatus: 'in-sync' | 'prop-drift' | 'structural-drift';
  structural: {
    added:    Array<{ componentType: string; index: number }>;
    removed:  Array<{ componentType: string; index: number }>;
    reordered: Array<{ componentType: string; fromIndex: number; toIndex: number }>;
  };
  props: Array<{
    path: string;           // e.g. '/content/0/props/title'
    componentType: string;
    propName: string;
    canonicalValue: unknown;
    translationValue: unknown;
    ownership: 'canonical' | 'locale';
    status: 'in-sync' | 'needs-translation' | 'locale-override' | 'structural-gap';
  }>;
}
```

`status` values:
- `in-sync` — values match; no action needed
- `needs-translation` — canonical-owned prop that has changed on the canonical; translation should update it
- `locale-override` — locale-owned prop; translation has its own value, canonical change is advisory
- `structural-gap` — a non-pinned component present on the canonical is absent from the translation (or vice versa); informational

---

## Relationship to PROPOSAL-010

Localization is built on the same infrastructure as template migration:

| Mechanism | Template migration (PROPOSAL-010) | Localization (this proposal) |
|---|---|---|
| Version tracking | `template_version` | `canonical_synced_version` |
| Drift detection | `template_version < current` | `canonical_synced_version < canonical current` |
| Change classification | `action_type` / `action_metadata` | `action_type` + RFC 6902 patch paths |
| Propagation | Migration job via queue | Localization agent on branch |
| Conflict handling | Conflict queue for human review | Branch merge review |
| Rollback | Pre-migration checkpoint | Branch discard |
| Structural enforcement | `validateDocumentStructure` | Same — all locale documents are template-conforming |

Localization documents are template-conforming documents. Template migrations propagate to all locale variants of a document — canonical and translated alike — using the existing migration job. There is no separate migration path for localized documents.

---

## What Needs to Be Built

**Schema:**
- `documents.locale TEXT NULL`
- `documents.canonical_document_id UUID NULL REFERENCES app.documents(id)`
- `documents.canonical_synced_version INTEGER NULL`
- Index on `(canonical_document_id, canonical_synced_version)`

**Template format extension:**
- `localeOwnership: 'canonical' | 'locale'` per prop in `TemplateComponent`
- Default: `canonical` when absent

**Locale diff endpoint:**
- `GET /api/sites/{siteId}/branches/{branchId}/documents/{path}/locale-diff`
- Computes structural diff and prop diff between translation and canonical
- Classifies each prop by ownership and sync status

**Drift detector:**
- Queryable: given a canonical document ID, return all translations with `canonical_synced_version` behind current
- Exposed as an API endpoint for agents to poll, or as a notification event on canonical version advance

**MCP tool: `list_locale_variants`**
- Given a document, return all locale variants and their sync status

**MCP tool: `get_locale_diff`**
- Wraps the locale diff endpoint for agent consumption

**Content validator extension:**
- `localeOwnership` enforcement: when an agent writes to a locale-managed prop on a translation, that's valid; when it writes to a canonical prop without going through the sync workflow, that should be flagged
- Enforcement detail TBD — may be a soft warning rather than a hard error

**`canonical_synced_version` update on branch merge:**
- When a localization branch is merged, `canonical_synced_version` is updated to the canonical's version at that moment

---

## Open Questions

1. **Notification mechanism** — how does the drift detector surface "translation X is behind" to the localization agent? Options: polling endpoint, Cloudflare Queue message on canonical version advance, or webhook. Depends on how the external localization agent is deployed.

2. **Locale creation workflow** — how does a site manager create a new locale variant of an existing document? Is there a "create translation" action that initializes the locale document from the canonical's current snapshot and sets `canonical_synced_version`?

3. **Bulk locale creation** — for sites with many existing documents, creating locale variants one at a time is impractical. A bulk initialization job (similar to the template migration job) would enumerate canonical documents and create empty or pre-populated translation stubs.

4. **Locale deletion and archival** — if a locale is discontinued, how are its documents handled? Soft-delete preserving version history, or hard archive?

5. **Selective translation** — not every canonical document needs a localized variant. Localized variants are opt-in: a canonical document with no `canonical_document_id` back-reference in any locale-specific document simply has no translation. The edge routing decision (serve canonical as fallback, return 404, redirect) is outside CSS's scope — CSS serves whatever document is requested and returns 404 if it doesn't exist. Fallback logic is an edge/CDN concern.

6. **Locale-native content creation workflow** — how does a site manager create locale-native content (no canonical counterpart)? The new page creation flow should allow selecting a locale without requiring a canonical document. Template selection still applies — a Quebec regulations page would still conform to a "regulatory" template.
