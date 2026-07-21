# PROPOSAL-010: Content Types and Template Migration — Critical User Journeys

**Source:** PROPOSAL-010: Content Types and Template Migration  
**Date:** 2026-06-12  
**Status:** Draft

This document defines the Critical User Journeys (CUJs) derived from PROPOSAL-010. Each CUJ traces to one or more sections of the proposal and covers the full lifecycle: template creation, document creation, role-differentiated editing, structural action capture, migration execution, conflict resolution, dry-run, rollback, and programmatic access.

---

## CUJ-1: Admin Creates a Content Type Template

**Persona:** Site Admin  
**Goal:** Define a reusable structural template so all documents of a type share a consistent skeleton.  
**Traces to:** Proposal sections 1, 4, 8; Appendix B, F.1

1. Admin navigates to template management (or `_registry/templates/` path)
2. Admin selects "Create New Template"
3. Admin defines the template: name, label, description, optional `defaultUrlPattern`
4. Admin adds components to the skeleton, marking each as **pinned** or **unpinned**
5. Admin saves the template — system creates a versioned document at `_registry/templates/{name}`
6. Template appears in the template list and is available for document creation

**Failure scenarios:**
- Non-admin attempts to create a template → 403 rejected
- Template with duplicate name at same path → error with clear message
- Template saved with zero components → system allows it (blank skeleton) or validates minimum structure

---

## CUJ-2: Author Creates a Document from a Template

**Persona:** Editor / Junior Editor / Admin  
**Goal:** Start a new page pre-populated with the correct structural skeleton.  
**Traces to:** Proposal sections 2, 3, 4; Appendix D

1. User initiates "New Page"
2. System presents a template selector populated from `_registry/templates/`
3. User selects "Blog" (or "Blank" to get today's behavior)
4. System suggests a default URL based on `defaultUrlPattern` (e.g., `/blog/:year/:month/:slug`) — this is a frontend suggestion only; all roles may set any path
5. User accepts or sets any URL they choose
6. System creates a new document initialized with the template's component skeleton in Puck's data format
7. `documents.template_id` and `documents.template_version` are set
8. User is dropped into the Puck editor with pinned components locked (no drag/delete) and editable props

**Failure scenarios:**
- Template has been deleted between selection and creation → graceful error
- User selects "Blank" → document created with `template_id = NULL`, today's behavior preserved

**Decision:** URL override permission is not enforced. The `defaultUrlPattern` is a frontend hint, not a backend constraint. All roles can create documents at arbitrary paths.

---

## CUJ-3: Junior Editor Edits a Templated Document (Restricted)

**Persona:** Junior Editor  
**Goal:** Edit content within the structural constraints of a template.  
**Traces to:** Proposal sections 4, 5; Appendix F.3

1. Junior Editor opens an existing templated document
2. Puck renders with `resolvePermissions` applied: pinned components show no drag/delete handles; insert/duplicate disabled for all components
3. Junior Editor edits prop values (title, body text, image URLs) on any component
4. Junior Editor saves — system writes a new document version with `action_type = null` (prop-only edit)
5. No structural actions are recorded in `action_metadata`

**Failure scenarios:**
- Junior Editor attempts to drag a pinned component → Puck UI prevents it
- Junior Editor attempts to add a new component → Puck UI prevents it
- Junior Editor attempts to remove a non-pinned component → Puck UI prevents it

---

## CUJ-4: Editor Makes Structural Customizations to a Templated Document

**Persona:** Editor  
**Goal:** Add, remove, or reorder non-pinned components while keeping pinned components intact.  
**Traces to:** Proposal sections 4, 5; Appendix C, F.3

1. Editor opens a templated document in Puck
2. Pinned components are locked (no drag/delete); non-pinned components are fully editable
3. Editor adds a new `TestimonialBlock` between `BodyBlock` and `CTABlock`
4. Editor reorders the non-pinned `CTABlock` to a different position
5. Puck fires `onAction` events (reorder/move) — frontend buffers them
6. Editor saves — structural actions are forwarded to the backend alongside the snapshot
7. Backend classifies the version as `action_type = 'structural'` and stores `puckActions` in `action_metadata`

**Failure scenarios:**
- Editor attempts to delete a pinned component → Puck UI prevents it
- Editor attempts to drag a pinned component → Puck UI prevents it
- Save fails mid-flight → no partial version written, editor can retry

---

## CUJ-5: Admin Edits a Template and Triggers Migration

**Persona:** Site Admin  
**Goal:** Evolve the structure of all documents of a type by editing the template.  
**Traces to:** Proposal sections 6, 7, 9; Appendix E, G

1. Admin opens the "Blog" template in the Puck editor
2. Admin inserts a new pinned `StatsBlock` between `BodyBlock` and `CTABlock`
3. Admin saves — system creates template version v6 with the structural action recorded
4. Admin navigates to migration controls for the Blog template
5. Admin triggers migration (explicit opt-in) for the current branch
6. System enumerates all documents where `template_id = Blog AND template_version < 6`
7. System processes documents in batches of ~50:
   - Writes pre-migration checkpoint per document
   - Checks for structural conflicts
   - For clean documents after delta application: runs `validateDocumentStructure` on the migrated snapshot. If validation fails, the document is written to the conflicts queue as `migration_result_invalid` rather than saved as a new version
   - Applies the delta to clean, validated documents
   - Writes conflicted documents to the `migration_conflicts` review queue
8. Admin sees a summary: X documents migrated, Y conflicts queued for review
9. `template_version` updated to 6 on all successfully migrated documents

**Failure scenarios:**
- Non-admin attempts to trigger migration → 403 rejected
- Migration partially completes before a system failure → checkpoints exist for rollback; un-processed documents remain at old `template_version`
- Template has no structural changes between versions → migration is a no-op
- Migrated snapshot fails `validateDocumentStructure` → routed to conflicts queue with `migration_result_invalid`, not written as a version

---

## CUJ-6: Admin Reviews and Resolves Migration Conflicts

**Persona:** Site Admin  
**Goal:** Resolve documents where editor customizations conflict with a template change.  
**Traces to:** Proposal section 6 (Conflict Detection); Appendix E.4

1. After migration, admin opens the migration conflicts queue
2. Each conflict shows:
   - The template delta (e.g., "reorder HeroBlock from index 2 to 0")
   - The document's structural actions since last migration (e.g., "reorder HeroBlock from index 2 to 3")
   - The affected document with a link to view it
3. Admin chooses a resolution per conflict:
   - **Apply** — force the template delta onto the document, overwriting the editor's customization
   - **Skip** — leave the document as-is; it will not receive this migration
   - **Manual** — admin opens the document and manually reconciles
4. System records `resolved_at` and `resolution` on the conflict record
5. For "Apply" resolution: system applies the delta and updates `template_version`

**Failure scenarios:**
- Admin resolves as "Apply" but the result still fails structural validation → written to conflicts queue again with `migration_result_invalid`
- Admin accidentally skips a conflict → conflict record persists, can be re-reviewed

---

## CUJ-7: Admin Dry-Runs a Template Migration via Branching

**Persona:** Site Admin  
**Goal:** Preview the impact of a template change before it affects production documents.  
**Traces to:** Proposal section 6 (Branch Scoping, Dry-run)

1. Admin creates a feature branch
2. Admin edits the template on that branch (e.g., adds a component, reorders structure)
3. Admin triggers migration preview on the branch
4. System shows: which documents would be updated, which have conflicts, what changes would apply
5. Admin reviews the preview:
   - If satisfied → merges the branch; migration runs against main-branch documents at merge time (see CUJ-13)
   - If not satisfied → discards the branch with zero consequence

**Failure scenarios:**
- Branch is merged before migration preview is reviewed → migration runs on main, which is acceptable but may produce unexpected conflicts
- Admin deletes the branch → all template changes and migration state on that branch are discarded cleanly

---

## CUJ-8: Admin Rolls Back a Migration

**Persona:** Site Admin  
**Goal:** Undo a migration that produced unexpected results.  
**Traces to:** Proposal section 6 (Rollback)

1. Admin identifies that a migration produced undesirable results on certain documents
2. **Per-document rollback:** Admin selects a specific document and reverts to its pre-migration checkpoint using the existing checkpoint/rollback system
3. **Bulk rollback:** Admin reverts the entire branch, discarding all migration changes at once
4. Rolled-back documents return to their pre-migration `template_version`

**Failure scenarios:**
- Checkpoint was not written (system bug) → rollback not possible for that document; admin must manually fix
- Admin rolls back a document that was subsequently edited post-migration → rollback loses the post-migration edits (confirm with admin first)

---

## CUJ-9: Agent/MCP Creates a Document from a Template

**Persona:** AI Agent via MCP Server  
**Goal:** Programmatically create a template-conforming document.  
**Traces to:** Proposal sections 9, 10 (Open Question 5); Appendix D.3, G

1. Agent calls `create_page` with `template_id` parameter
2. System fetches the template snapshot and generates the initial Puck skeleton
3. Document created with `template_id` and `template_version` set
4. Agent calls `apply_document_edits` to populate prop values
5. Backend runs `validateDocumentStructure` — confirms pinned components are present and in order
6. Backend runs `validateOps` — confirms prop values are valid
7. Both validations must pass independently — a document can pass one and fail the other
8. Document version saved

**Failure scenarios:**
- Agent supplies edits that remove a pinned component → `validateDocumentStructure` rejects with `missing_pinned_component`
- Agent supplies edits that reorder pinned components → rejected with `pinned_component_out_of_order`
- Agent omits `template_id` → blank document created (today's behavior)
- `template_id` references a non-existent template → error returned

---

## CUJ-10: Listing Available Templates

**Persona:** Any authenticated user  
**Goal:** See what templates are available for document creation.  
**Traces to:** Proposal section 8; Appendix B

1. User (or agent) requests the template list via `GET /api/sites/{siteId}/branches/{branchId}/templates` or the `list_templates` MCP tool
2. System queries documents at `_registry/templates/` path prefix
3. Returns template metadata: id, name, label, description, defaultUrlPattern, component list
4. Templates are branch-scoped — a template edited on a feature branch only appears in that branch's listing; other branches see the unmodified version

**Failure scenarios:**
- No templates exist → empty list returned; "Blank" is always available in the UI
- User lacks site access → 403
- Template documents are excluded from regular `list_documents` results via the existing `_registry/` exclusion

---

## CUJ-11: Agent Makes Structural Edits to a Templated Document

**Persona:** AI Agent via MCP Server  
**Goal:** Programmatically restructure a templated document; system still captures structural intent for migration conflict detection.  
**Traces to:** Proposal section 5 (fallback classification); Appendix C.2

1. Agent calls `apply_document_edits` with ops that add, remove, or reorder components on a templated document
2. No `puckActions` are forwarded (agent is not a Puck session)
3. Backend inspects the RFC 6902 patch paths — detects structural change via path pattern (`/content/N` without deeper path segments)
4. Backend sets `action_type = 'structural'` with `action_metadata = { derived: true }`
5. `validateDocumentStructure` runs — confirms pinned components remain present and in order
6. Version saved; structural classification is available for future migration conflict detection

**Failure scenarios:**
- Agent removes a pinned component → `validateDocumentStructure` rejects with `missing_pinned_component`
- Agent reorders pinned components → rejected with `pinned_component_out_of_order`
- Derived classification is less precise than explicit Puck actions — accepted trade-off for non-interactive edits, which are already subject to the content validator

---

## CUJ-12: Prop-Only Documents Auto-Migrate Without Conflict

**Persona:** Site Admin (triggers migration); Editors (unaware it happened)  
**Goal:** Template migration applies cleanly to documents where editors only changed content, not structure.  
**Traces to:** Proposal section 6 (Conflict Detection — "the common case")

1. Admin edits the Blog template — adds a new pinned `StatsBlock`
2. Admin triggers migration on the branch
3. System enumerates all blog documents with `template_version < current`
4. Documents with `action_metadata = null` on all versions since last migration (editors only changed props) are classified as **clean** — no conflict check needed
5. System writes pre-migration checkpoints, applies the delta, updates `template_version` — all automatic, no human review required
6. Documents with structural customizations proceed through full conflict detection (CUJ-5, CUJ-6)
7. Editors open their previously-edited blog posts and find the new `StatsBlock` present — their content is preserved

**Why this matters:** This is the dominant path. The majority of documents will have prop-only edits and will migrate silently, making the migration system practical at scale.

---

## CUJ-13: Template Changes Propagate to Main at Merge Time

**Persona:** Site Admin  
**Goal:** Publishing a branch with template edits triggers migration on main-branch documents.  
**Traces to:** Proposal section 6 (Branch Scoping — "Migration propagates to main only via the publish action")

1. Admin edits the Blog template on a feature branch, creating template v6
2. Admin runs migration on the feature branch — branch documents updated successfully (CUJ-5)
3. Admin previews results on the branch (CUJ-7)
4. Admin merges/publishes the branch to main
5. System detects that the Blog template on main is now at v6 but main-branch documents still reference v5
6. Migration runs against main-branch documents with `template_id = Blog AND template_version < 6`
7. Same conflict detection, checkpoint, and batch processing behavior as branch-local migration

**Failure scenarios:**
- Main-branch documents have structural edits not present on the feature branch → new conflicts surfaced at merge time that weren't visible during branch preview
- Two branches with independent template edits merged sequentially → second merge must reconcile both sets of changes (deferred per Open Question 4)

---

## CUJ-14: Admin Deprecates a Template

**Persona:** Site Admin  
**Goal:** Retire a template so no new documents use it, while existing documents continue to function.  
**Traces to:** Proposal section 10 (Open Question 2)

1. Admin marks a template as deprecated (or deletes the template document)
2. Template no longer appears in the template selector for new document creation
3. Existing documents with `template_id` referencing the deprecated template continue to function — editors can still edit them
4. No further migrations are possible for this template
5. Existing documents retain their `template_id` (not nulled out) — they remain structurally constrained by their last-migrated template version

**Open questions:**
- Should deprecated-template documents be flagged as "unmanaged" in the UI?
- Should pinning still be enforced if the template document no longer exists, or should constraints relax?
- Should there be a bulk "disassociate" action to null out `template_id` on all associated documents?

---

## CUJ-15: Pinning Changes Take Effect Immediately Without Migration

**Persona:** Site Admin (changes pinning); Editor (experiences the change)  
**Goal:** When a template changes a component's pinned status, editor constraints update immediately for all documents on that branch — no migration required.  
**Traces to:** Appendix F.3 (`resolvePermissions` is called per component instance against the live template definition)

1. Admin edits the Blog template — changes `CTABlock` from `pinned: false` to `pinned: true`
2. Admin saves the template (new template version created)
3. Editor opens an existing Blog document on the same branch
4. `resolvePermissions` fetches the **live** template definition — `CTABlock` is now pinned
5. Puck renders `CTABlock` with `drag: false, delete: false` — Editor can no longer move or remove it
6. **No migration was triggered** — this is a permissions change, not a structural change
7. Conversely: if Admin changes `CTABlock` back to `pinned: false`, editors can immediately drag/delete it again

**Why this matters:** Pinning is enforced dynamically from the live template, not baked into documents at creation time. This means permission changes are instant across all documents on the branch, while structural position changes (reordering, inserting, removing components) require migration.

**Failure scenarios:**
- Editor had the document open before the pinning change → next `resolvePermissions` call picks up the new state (on page refresh or next Puck render cycle)
- Admin pins a component that some editors have already deleted from their documents → pinning has no effect on those documents since the component is absent; a migration (CUJ-5) would be needed to re-insert it

---

## Traceability Matrix

| Proposal Section | CUJs |
|---|---|
| 1. What a Template Is | CUJ-1 |
| 2. Document-Template Association | CUJ-2 |
| 3. Creating a Document from a Template | CUJ-2 |
| 4. Role-Based Editing | CUJ-1, CUJ-2, CUJ-3, CUJ-4 |
| 5. Structural Action Capture | CUJ-3, CUJ-4, CUJ-11 |
| 6. Template Migration | CUJ-5, CUJ-6, CUJ-7, CUJ-8, CUJ-12, CUJ-13 |
| 7. Scale | CUJ-5, CUJ-12 |
| 8. What Needs to Be Built | CUJ-1, CUJ-2, CUJ-5, CUJ-10 |
| 9. Content Validator (PCC-3169) | CUJ-5, CUJ-9, CUJ-11 |
| 10. Open Questions | CUJ-13, CUJ-14 |
| Appendix B: Template Storage | CUJ-1, CUJ-10 |
| Appendix C: onAction Forwarding | CUJ-4, CUJ-11 |
| Appendix D: Template Selector UI | CUJ-2 |
| Appendix E: Migration Job | CUJ-5, CUJ-6, CUJ-12 |
| Appendix F: Role Enforcement | CUJ-2, CUJ-3, CUJ-4, CUJ-15 |
| Appendix G: validateDocumentStructure | CUJ-5, CUJ-9, CUJ-11 |
