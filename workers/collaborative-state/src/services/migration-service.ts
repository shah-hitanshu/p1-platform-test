/**
 * Migration service keyed by slot id.
 *
 * A template's delta between two versions is an id-keyed diff of the two
 * version snapshots: components added (carried with their full props),
 * removed, moved, plus per-slot prop patches. Applying a delta to a document
 * matches components by slot id, so document-local components keep their
 * place. A document conflicts with a template change only where the template
 * delta and the document's own edits since its last migration touch the same
 * slot id, structurally or on the same prop.
 *
 * Key operations:
 * - Trigger migration jobs with pre-migration checkpoints
 * - Detect slot-id conflicts between template changes and document edits
 * - Apply template deltas to document snapshots
 * - Rollback failed migrations using checkpoints
 *
 * @see proposals/PROPOSAL-015-durable-slot-identity.md Design 5
 * @see proposals/PROPOSAL-010-content-types-and-template-migration.md
 */

import { compare as jsonPatchCompare, type Operation } from 'fast-json-patch';
import { query, withTransaction } from '../db';
import { createCheckpoint, revertToCheckpoint } from './checkpoint-service';
import {
  getLatestDocumentVersion,
  getLatestPublishedDocumentVersion,
  createDocumentVersion,
  reconstructVersionSnapshot,
} from './document-version-service';
import { TEMPLATE_RELATION_INNER_JOIN, branchInheritsFromMain } from './document-queries';
import { walkComponents } from './component-identity';
import {
  buildSlotDelta,
  applySlotDelta,
  touchedSlotIds,
  isSlotDelta,
  type SlotDelta,
} from './slot-delta';

// =============================================================================
// Types
// =============================================================================

/**
 * Principal (actor) for audit trail.
 */
export interface MigrationPrincipal {
  id: string;
  type: 'user' | 'agent' | 'system';
}

/**
 * Migration job record from migration_jobs table.
 */
export interface MigrationJob {
  id: string;
  siteId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  checkpointId: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'completed_with_conflicts' | 'failed';
  totalDocuments: number;
  processedDocuments: number;
  createdById: string;
  createdByType: 'user' | 'agent' | 'system';
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Migration conflict record from migration_conflicts table.
 */
export interface MigrationConflict {
  id: string;
  migrationJobId: string;
  documentId: string;
  branchId: string;
  templateId: string;
  fromVersion: number;
  toVersion: number;
  templateDelta: unknown;
  documentDelta: unknown;
  propConflicts: PropConflict[];
  conflictType: 'structural' | 'prop';
  resolution: 'apply' | 'skip' | 'manual' | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/**
 * A prop-level patch for a single component, derived from RFC6902 diffs
 * between template snapshots.
 */
export interface PropPatch {
  componentId: string;
  operations: Operation[];
}

/**
 * Combined migration delta: the id-keyed structural diff plus prop patches.
 */
export interface MigrationDelta {
  slotDelta: SlotDelta;
  propPatches: PropPatch[];
}

/**
 * Options for applying prop patches during migration.
 */
export interface PropMigrationOptions {
  propPatches: PropPatch[];
  fromTemplateContent: { type?: string; props?: Record<string, unknown> }[];
  fromRootProps?: Record<string, unknown>;
  fromZones?: Record<string, { type?: string; props?: Record<string, unknown> }[]>;
}

/**
 * A prop-level conflict detected during migration.
 */
export interface PropConflict {
  componentId: string;
  propPath: string;
  templateOldValue: unknown;
  templateNewValue: unknown;
  documentValue: unknown;
}

/**
 * Document with latest version snapshot.
 */
export interface DocumentWithSnapshot {
  id: string;
  siteId: string;
  branchId: string;
  path: string;
  templateId: string | null;
  templateVersion: number | null;
  snapshot: Record<string, unknown>;
}

/**
 * Conflict detection result. `hasConflict` marks structural conflicts, which
 * hold the whole document. `propConflicts` lists props the template changed
 * that the document locally edited; the migration applies the document's clean
 * changes and records these for resolution rather than dropping them.
 */
export interface ConflictResult {
  hasConflict: boolean;
  templateDelta: SlotDelta;
  documentDelta: SlotDelta;
  propConflicts?: PropConflict[];
}

/**
 * Per-document preview result for migration preview. `applied` is whether the
 * migration would advance this document's `synced_version`; `propConflicts`
 * lists the props held for review and `structuralConflict` is present only when
 * the document's own structural edit collided with the template's, holding the
 * whole document. A clean document is `applied` with no review detail; a prop
 * conflict is `applied` with props to review; a structural conflict is not
 * applied and carries `structuralConflict`.
 */
export interface MigrationPreviewDocument {
  documentId: string;
  path: string;
  currentTemplateVersion: number | null;
  applied: boolean;
  propConflicts: PropConflict[];
  proposedSnapshot?: Record<string, unknown>;
  structuralConflict?: {
    templateDelta: SlotDelta;
    documentDelta: SlotDelta;
  };
  /** Equals `!applied`; retained for the contract's compatibility window. */
  hasConflict: boolean;
}

/**
 * Migration preview result. Summarises what a migration would do
 * without applying any changes.
 */
export interface MigrationPreview {
  templateId: string;
  fromVersion: number;
  toVersion: number;
  templateDelta: SlotDelta;
  // Count of prop-level default changes, applied during migration but not
  // part of the structural templateDelta.
  propChangeCount: number;
  affectedDocuments: number;
  estimatedConflicts: number;
  cleanDocuments: number;
  documents?: MigrationPreviewDocument[];
}

// =============================================================================
// Error Classes
// =============================================================================

export class TemplateNotFoundError extends Error {
  public readonly name = 'TemplateNotFoundError';
  constructor(public readonly templateId: string) {
    super(`Template with ID "${templateId}" not found.`);
    Object.setPrototypeOf(this, TemplateNotFoundError.prototype);
  }
}

export class MigrationJobNotFoundError extends Error {
  public readonly name = 'MigrationJobNotFoundError';
  constructor(public readonly jobId: string) {
    super(`Migration job with ID "${jobId}" not found.`);
    Object.setPrototypeOf(this, MigrationJobNotFoundError.prototype);
  }
}

export class InvalidVersionRangeError extends Error {
  public readonly name = 'InvalidVersionRangeError';
  constructor(fromVersion: number, toVersion: number) {
    super(`Invalid version range: from=${String(fromVersion)}, to=${String(toVersion)} (from must be < to)`);
    Object.setPrototypeOf(this, InvalidVersionRangeError.prototype);
  }
}

export class LegacyConflictDeltaError extends Error {
  public readonly name = 'LegacyConflictDeltaError';
  constructor(public readonly conflictId: string) {
    super(
      `Migration conflict "${conflictId}" holds a legacy action-array delta that predates the ` +
        'id-keyed engine; re-run the migration to regenerate its conflicts.',
    );
    Object.setPrototypeOf(this, LegacyConflictDeltaError.prototype);
  }
}

export class ConflictAlreadyResolvedError extends Error {
  public readonly name = 'ConflictAlreadyResolvedError';
  constructor(
    public readonly conflictId: string,
    public readonly existingResolution: string,
  ) {
    super(
      `Migration conflict "${conflictId}" is already resolved as "${existingResolution}".`,
    );
    Object.setPrototypeOf(this, ConflictAlreadyResolvedError.prototype);
  }
}

// =============================================================================
// Row Mappers
// =============================================================================

interface MigrationJobRow {
  id: string;
  site_id: string;
  branch_id: string;
  template_id: string;
  from_version: number;
  to_version: number;
  checkpoint_id: string | null;
  status: string;
  total_documents: number;
  processed_documents: number;
  created_by_id: string;
  created_by_type: string;
  created_at: string;
  completed_at: string | null;
}

interface MigrationConflictRow {
  id: string;
  migration_job_id: string;
  document_id: string;
  branch_id: string;
  template_id: string;
  from_version: number;
  to_version: number;
  template_delta: unknown;
  document_actions: unknown;
  prop_conflicts: unknown;
  conflict_type: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

function mapRowToJob(row: MigrationJobRow): MigrationJob {
  return {
    id: row.id,
    siteId: row.site_id,
    branchId: row.branch_id,
    templateId: row.template_id,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    checkpointId: row.checkpoint_id,
    status: row.status as MigrationJob['status'],
    totalDocuments: row.total_documents,
    processedDocuments: row.processed_documents,
    createdById: row.created_by_id,
    createdByType: row.created_by_type as MigrationJob['createdByType'],
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at !== null && row.completed_at !== '' ? new Date(row.completed_at) : null,
  };
}

/**
 * jsonb columns can surface as a parsed value or, after a double-encode, as a
 * JSON string; coerce prop-conflict payloads back to an array either way.
 */
function parsePropConflictsColumn(value: unknown): PropConflict[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as PropConflict[]) : [];
}

function mapRowToConflict(row: MigrationConflictRow): MigrationConflict {
  return {
    id: row.id,
    migrationJobId: row.migration_job_id,
    documentId: row.document_id,
    branchId: row.branch_id,
    templateId: row.template_id,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    templateDelta: row.template_delta,
    documentDelta: row.document_actions,
    propConflicts: parsePropConflictsColumn(row.prop_conflicts),
    conflictType: row.conflict_type as MigrationConflict['conflictType'],
    resolution: row.resolution as MigrationConflict['resolution'],
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at !== null && row.resolved_at !== '' ? new Date(row.resolved_at) : null,
  };
}

// =============================================================================
// Delta Application Helpers
// =============================================================================

/**
 * Applies a slot delta to a document snapshot without mutating the input.
 * Structural changes match by slot id through `applySlotDelta`; prop patches
 * then merge three-way, applying only where the document value still equals
 * the template's old value so local edits survive.
 */
export function applyDeltaToSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  delta: SlotDelta,
  propMigration?: PropMigrationOptions,
): Record<string, unknown> {
  if (!snapshot) {
    return {};
  }

  const result = applySlotDelta(snapshot, delta);

  if (!propMigration || propMigration.propPatches.length === 0) {
    return result;
  }

  const content = Array.isArray(result.content) ? result.content as unknown[] : [];
  const root = result.root as { props?: Record<string, unknown> } | undefined;
  const zones = result.zones as Record<string, unknown[]> | undefined;

  const fromContentMap = new Map<string, Record<string, unknown>>();
  for (const c of propMigration.fromTemplateContent) {
    const id = c.props?.id;
    if (typeof id === 'string') {
      fromContentMap.set(id, { ...c.props });
    }
  }

  const fromZonesMap = new Map<string, Record<string, unknown>>();
  if (propMigration.fromZones) {
    for (const zoneComps of Object.values(propMigration.fromZones)) {
      for (const c of zoneComps) {
        const id = c.props?.id;
        if (typeof id === 'string') {
          fromZonesMap.set(id, { ...c.props });
        }
      }
    }
  }

  for (const patch of propMigration.propPatches) {
    if (patch.componentId === '__root__') {
      if (!root?.props || !propMigration.fromRootProps) continue;
      // Root props merge through the same applier as components, so nested paths
      // like `/_meta/ogTitle` and `add`/`remove` behave identically on both.
      mergePropPatch(root.props, propMigration.fromRootProps, patch.operations);
      continue;
    }

    let applied = false;
    for (const entry of content) {
      const comp = entry as ComponentLike;
      if (comp.props?.id !== patch.componentId) {
        continue;
      }
      const fromProps = fromContentMap.get(patch.componentId) ?? fromZonesMap.get(patch.componentId);
      if (fromProps) {
        mergePropPatch(comp.props, fromProps, patch.operations);
        applied = true;
      }
      break;
    }
    if (applied) continue;

    if (zones) {
      for (const zoneContent of Object.values(zones)) {
        if (!Array.isArray(zoneContent)) continue;
        for (const entry of zoneContent) {
          const comp = entry as ComponentLike;
          if (comp.props?.id !== patch.componentId) {
            continue;
          }
          const fromProps = fromZonesMap.get(patch.componentId) ?? fromContentMap.get(patch.componentId);
          if (fromProps) {
            mergePropPatch(comp.props, fromProps, patch.operations);
          }
          applied = true;
          break;
        }
        if (applied) break;
      }
    }
  }

  return result;
}

/**
 * Overwrites each op's target only where the document value still equals the
 * template's old value, leaving diverged props for the caller to flag.
 */
function mergePropPatch(
  props: Record<string, unknown>,
  fromProps: Record<string, unknown>,
  operations: Operation[],
): void {
  for (const op of operations) {
    const docValue = getNestedValue(props, op.path);
    const templateOldValue = getNestedValue(fromProps, op.path);
    if (deepEqual(docValue, templateOldValue)) {
      applyPropOp(props, op);
    }
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const key = path.replace(/^\//, '');
  if (!key.includes('/')) return obj[key];
  const segments = key.split('/');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      current = isNaN(idx) ? undefined : current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

function applyPropOp(props: Record<string, unknown>, op: Operation): void {
  const key = op.path.replace(/^\//, '');
  if (op.op === 'replace' || op.op === 'add') {
    if (!key.includes('/')) {
      props[key] = (op as { value: unknown }).value;
    } else {
      setNestedValue(props, key, (op as { value: unknown }).value);
    }
  } else if (op.op === 'remove') {
    if (!key.includes('/')) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete props[key];
    } else {
      deleteNestedValue(props, key);
    }
  }
}

function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const segments = path.split('/');
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== 'object') return;
    const seg = segments[i];
    if (seg === undefined) return;
    current = (current as Record<string, unknown>)[seg];
  }
  if (current !== null && current !== undefined && typeof current === 'object') {
    const lastSeg = segments[segments.length - 1];
    if (lastSeg === undefined) return;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (current as Record<string, unknown>)[lastSeg];
  }
}

/**
 * Missing parents are created, because adding `/_meta/author` to a page that has
 * no `_meta` yet is the ordinary case for a newly defined field — every page
 * predating the field is in that state. An existing non-object parent is left
 * alone rather than clobbered.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('/');
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== 'object') return;
    const seg = segments[i];
    if (seg === undefined) return;
    const parent = current as Record<string, unknown>;
    if (parent[seg] === undefined || parent[seg] === null) {
      const nextSeg = segments[i + 1];
      parent[seg] = nextSeg !== undefined && /^\d+$/.test(nextSeg) ? [] : {};
    }
    current = parent[seg];
  }
  if (current !== null && current !== undefined && typeof current === 'object') {
    const lastSeg = segments[segments.length - 1];
    if (lastSeg === undefined) return;
    (current as Record<string, unknown>)[lastSeg] = value;
  }
}

// =============================================================================
// Prop Patch Extraction
// =============================================================================

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

interface ComponentLike { type?: string; props?: Record<string, unknown> }

function buildIdMap(
  components: unknown[],
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const c of components) {
    const comp = c as ComponentLike;
    const id = comp.props?.id;
    if (typeof id === 'string') {
      map.set(id, { ...comp.props });
    }
  }
  return map;
}

function diffComponentProps(
  fromProps: Record<string, unknown>,
  toProps: Record<string, unknown>,
  componentId: string,
): PropPatch | null {
  const ops = jsonPatchCompare(fromProps, toProps).filter(
    op => !op.path.endsWith('/id') && op.path !== '/id',
  );
  if (ops.length === 0) return null;
  return { componentId, operations: ops };
}

// Template metadata (_template) and pin state (_pinMap) are editor-private
// root props; they are excluded from migration propagation so they never
// overwrite props on associated pages. Every other root prop, including any
// with a leading underscore, is a page-inheritable authored value.
const EDITOR_PRIVATE_ROOT_PROPS = new Set(['_template', '_pinMap']);

function stripEditorPrivateRootProps(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return props;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (EDITOR_PRIVATE_ROOT_PROPS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

function extractPropPatches(
  fromSnapshot: Record<string, unknown> | null,
  toSnapshot: Record<string, unknown> | null,
): PropPatch[] {
  if (!fromSnapshot || !toSnapshot) return [];

  const patches: PropPatch[] = [];

  // Content components
  const fromContent = Array.isArray(fromSnapshot.content) ? fromSnapshot.content as unknown[] : [];
  const toContent = Array.isArray(toSnapshot.content) ? toSnapshot.content as unknown[] : [];
  const fromMap = buildIdMap(fromContent);
  const toMap = buildIdMap(toContent);

  for (const [id, toProps] of toMap) {
    const fromProps = fromMap.get(id);
    if (!fromProps) continue;
    const patch = diffComponentProps(fromProps, toProps, id);
    if (patch) patches.push(patch);
  }

  // Root props
  // An absent baseline root is an empty one, so a template that gains its first
  // root prop still emits an `add`. An absent *target* root is treated as no
  // change rather than an emptied one, so a snapshot without a root object never
  // strips authored props off the pages.
  const fromRoot = stripEditorPrivateRootProps(
    (fromSnapshot.root as { props?: Record<string, unknown> } | undefined)?.props,
  ) ?? {};
  const toRoot = stripEditorPrivateRootProps(
    (toSnapshot.root as { props?: Record<string, unknown> } | undefined)?.props,
  );
  if (toRoot && !deepEqual(fromRoot, toRoot)) {
    const ops = jsonPatchCompare(fromRoot, toRoot);
    if (ops.length > 0) {
      patches.push({ componentId: '__root__', operations: ops });
    }
  }

  // Zone components
  const fromZones = (fromSnapshot.zones ?? {}) as Record<string, unknown[]>;
  const toZones = (toSnapshot.zones ?? {}) as Record<string, unknown[]>;
  const allZoneKeys = new Set([...Object.keys(fromZones), ...Object.keys(toZones)]);
  for (const zoneKey of allZoneKeys) {
    const fz = fromZones[zoneKey] ?? [];
    const tz = toZones[zoneKey] ?? [];
    const fzMap = buildIdMap(fz);
    const tzMap = buildIdMap(tz);
    for (const [id, toProps] of tzMap) {
      const fromProps = fzMap.get(id);
      if (!fromProps) continue;
      const patch = diffComponentProps(fromProps, toProps, id);
      if (patch) patches.push(patch);
    }
  }

  return patches;
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * The branch a template's versions should be read from during migration: the
 * given branch when it has edited the template locally, otherwise `mainBranchId`,
 * which a non-main branch inherits the template from. Returns the given branch
 * unchanged when no distinct main branch is supplied (copy-on-write disabled).
 */
async function resolveTemplateReadBranch(
  templateId: string,
  branchId: string,
  mainBranchId?: string,
): Promise<string> {
  if (!branchInheritsFromMain(branchId, mainBranchId)) {
    return branchId;
  }

  const local = await query(
    `SELECT 1 FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2 LIMIT 1`,
    [templateId, branchId],
  );
  return local.rows.length > 0 ? branchId : mainBranchId;
}

/**
 * The snapshot a page inherits from main: main's latest published version,
 * reconstructed if stored without a full snapshot. Null when no distinct main
 * branch is supplied or main has no published version to inherit.
 */
async function getInheritedPublishedSnapshot(
  documentId: string,
  branchId: string,
  mainBranchId?: string,
): Promise<Record<string, unknown> | null> {
  if (!branchInheritsFromMain(branchId, mainBranchId)) {
    return null;
  }

  const mainVersion = await getLatestPublishedDocumentVersion(documentId, mainBranchId);
  if (mainVersion === null) {
    return null;
  }

  return mainVersion.snapshot ?? await reconstructVersionSnapshot(
    documentId, mainBranchId, mainVersion.versionNumber,
  );
}

/**
 * Advances a template edge's synced_version for one source document. On a branch
 * that inherits the edge, the advance is recorded as a per-branch override so the
 * shared base — main's version — stays put; otherwise it writes the base directly.
 */
async function advanceSyncedVersion(
  documentId: string,
  branchId: string,
  toVersion: number,
  useOverride: boolean,
): Promise<void> {
  if (useOverride) {
    await query(
      `INSERT INTO app.document_relation_branch_sync
         (source_document_id, relation_type, branch_id, synced_version)
       VALUES ($1, 'template', $2, $3)
       ON CONFLICT (source_document_id, relation_type, branch_id)
       DO UPDATE SET synced_version = EXCLUDED.synced_version, updated_at = NOW()`,
      [documentId, branchId, toVersion],
    );
    return;
  }
  await query(
    `UPDATE app.document_relations SET synced_version = $1
     WHERE source_document_id = $2 AND relation_type = 'template'`,
    [toVersion, documentId],
  );
}

export async function extractTemplateDelta(
  templateId: string,
  branchId: string,
  fromVersion: number,
  toVersion: number,
  mainBranchId?: string,
): Promise<MigrationDelta> {
  // Read the template from main when this branch inherits it rather than having
  // edited it locally.
  const readBranchId = await resolveTemplateReadBranch(templateId, branchId, mainBranchId);
  const fromSnapshot = await reconstructVersionSnapshot(templateId, readBranchId, fromVersion);
  const toSnapshot = await reconstructVersionSnapshot(templateId, readBranchId, toVersion);

  // A from-version without a content array predates the content-shape
  // conversion. Diffing a manifest against the content shape would read every
  // component as added; the conversion is a representation change, so the
  // delta across that boundary is empty.
  if (!Array.isArray((fromSnapshot as { content?: unknown } | null)?.content)) {
    return { slotDelta: buildSlotDelta(null, null), propPatches: [] };
  }

  const slotDelta = buildSlotDelta(fromSnapshot, toSnapshot);
  const propPatches = extractPropPatches(fromSnapshot, toSnapshot);

  return { slotDelta, propPatches };
}

export async function getMigrationJob(jobId: string): Promise<MigrationJob> {
  const result = await query<MigrationJobRow>(
    'SELECT * FROM app.migration_jobs WHERE id = $1',
    [jobId],
  );

  if (result.rows.length === 0) {
    throw new MigrationJobNotFoundError(jobId);
  }

  const jobRow = result.rows[0];
  if (!jobRow) {
    throw new MigrationJobNotFoundError(jobId);
  }
  return mapRowToJob(jobRow);
}

export async function listMigrationConflicts(jobId: string): Promise<MigrationConflict[]> {
  const result = await query<MigrationConflictRow>(
    'SELECT * FROM app.migration_conflicts WHERE migration_job_id = $1 ORDER BY created_at ASC',
    [jobId],
  );

  return result.rows.map(mapRowToConflict);
}

interface AffectedDocumentRow {
  id: string;
  site_id: string;
  path: string;
  template_id: string | null;
  template_version: number | null;
  snapshot: Record<string, unknown>;
}

type AffectedDocumentsQuery = [sql: string, params: unknown[]];

// A page inherited from main — published there, not yet edited on this branch —
// resolves its template edge through the branch's per-branch sync override. UNION
// the branch-local matches with those inherited-published pages so both migrate.
function affectedDocumentsInheritingMainQuery(
  branchId: string,
  templateId: string,
  toVersion: number,
  limit: number,
  offset: number,
  mainBranchId: string,
): AffectedDocumentsQuery {
  return [
    `SELECT id, site_id, path, template_id, template_version, snapshot FROM (
       SELECT d.id, d.site_id, d.path,
         dr.target_document_id AS template_id,
         COALESCE(brs.synced_version, dr.synced_version) AS template_version,
         dv.snapshot
       FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       LEFT JOIN app.document_relation_branch_sync brs
         ON brs.source_document_id = d.id AND brs.relation_type = 'template' AND brs.branch_id = $1
       JOIN LATERAL (
         SELECT snapshot FROM app.document_versions local_dv
         WHERE local_dv.document_id = d.id AND local_dv.branch_id = $1
         ORDER BY local_dv.version_number DESC LIMIT 1
       ) dv ON true
       WHERE dr.target_document_id = $2
         AND (COALESCE(brs.synced_version, dr.synced_version) IS NULL
              OR COALESCE(brs.synced_version, dr.synced_version) < $3)
         AND d.archived_at IS NULL

       UNION

       SELECT d.id, d.site_id, d.path,
         dr.target_document_id AS template_id,
         dr.synced_version AS template_version,
         dv.snapshot
       FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       INNER JOIN app.document_versions dv ON dv.document_id = d.id
       INNER JOIN app.checkpoint_documents cd ON cd.document_version_id = dv.id
       INNER JOIN app.checkpoints cp ON cp.id = cd.checkpoint_id
       WHERE dr.target_document_id = $2
         AND (dr.synced_version IS NULL OR dr.synced_version < $3)
         AND d.archived_at IS NULL
         AND dv.branch_id = $6
         AND cp.branch_id = $6
         AND cp.checkpoint_type = 'publish'
         AND NOT EXISTS (
           SELECT 1 FROM app.document_versions local_dv
           WHERE local_dv.document_id = d.id AND local_dv.branch_id = $1
         )
         AND dv.version_number = (
           SELECT MAX(pub_dv.version_number)
           FROM app.document_versions pub_dv
           INNER JOIN app.checkpoint_documents pub_cd ON pub_cd.document_version_id = pub_dv.id
           INNER JOIN app.checkpoints pub_cp ON pub_cp.id = pub_cd.checkpoint_id
           WHERE pub_dv.document_id = d.id AND pub_dv.branch_id = $6
             AND pub_cp.branch_id = $6 AND pub_cp.checkpoint_type = 'publish'
         )
     ) combined
     ORDER BY id
     LIMIT $4 OFFSET $5`,
    [branchId, templateId, toVersion, limit, offset, mainBranchId],
  ];
}

function affectedDocumentsLocalQuery(
  branchId: string,
  templateId: string,
  toVersion: number,
  limit: number,
  offset: number,
): AffectedDocumentsQuery {
  return [
    `SELECT d.id, d.site_id, d.path,
       dr.target_document_id AS template_id,
       dr.synced_version AS template_version,
       dv.snapshot
     FROM app.documents d
     ${TEMPLATE_RELATION_INNER_JOIN}
     JOIN LATERAL (
       SELECT snapshot FROM app.document_versions
       WHERE document_id = d.id AND branch_id = $1
       ORDER BY version_number DESC LIMIT 1
     ) dv ON true
     WHERE dr.target_document_id = $2
       AND (dr.synced_version IS NULL OR dr.synced_version < $3)
       AND d.archived_at IS NULL
     ORDER BY d.id
     LIMIT $4 OFFSET $5`,
    [branchId, templateId, toVersion, limit, offset],
  ];
}

export async function findAffectedDocuments(
  siteId: string,
  branchId: string,
  templateId: string,
  toVersion: number,
  limit: number,
  offset: number,
  mainBranchId?: string,
): Promise<DocumentWithSnapshot[]> {
  void siteId;

  // Affected pages resolve to their latest local version on the branch. On a
  // non-main branch, a page inherited from main and not yet edited here also
  // counts, at main's latest published version; migrating it writes its first
  // branch-local version.
  const [sql, params] = branchInheritsFromMain(branchId, mainBranchId)
    ? affectedDocumentsInheritingMainQuery(branchId, templateId, toVersion, limit, offset, mainBranchId)
    : affectedDocumentsLocalQuery(branchId, templateId, toVersion, limit, offset);

  const result = await query<AffectedDocumentRow>(sql, params);

  return result.rows.map((row) => ({
    id: row.id,
    siteId: row.site_id,
    branchId,
    path: row.path,
    templateId: row.template_id,
    templateVersion: row.template_version,
    snapshot: row.snapshot,
  }));
}

export async function detectDocumentConflicts(
  documentId: string,
  branchId: string,
  templateDelta: SlotDelta,
  documentSnapshot: Record<string, unknown>,
  propConflictOptions?: PropMigrationOptions,
): Promise<ConflictResult | null> {
  const baselineVersion = await resolveBaselineVersion(documentId, branchId);
  const baselineSnapshot = await reconstructVersionSnapshot(documentId, branchId, baselineVersion);
  const documentDelta = buildSlotDelta(baselineSnapshot, documentSnapshot);

  const templateTouched = new Set(touchedSlotIds(templateDelta));
  const hasStructuralConflict = touchedSlotIds(documentDelta).some((id) => templateTouched.has(id));

  const propConflicts: PropConflict[] = [];
  if (propConflictOptions) {
    const fromMap = new Map<string, Record<string, unknown>>();
    for (const c of propConflictOptions.fromTemplateContent) {
      const id = c.props?.id;
      if (typeof id === 'string') {
        fromMap.set(id, { ...c.props });
      }
    }
    if (propConflictOptions.fromZones) {
      for (const zoneComps of Object.values(propConflictOptions.fromZones)) {
        for (const c of zoneComps) {
          const id = c.props?.id;
          if (typeof id === 'string') {
            fromMap.set(id, { ...c.props });
          }
        }
      }
    }

    const docMap = new Map<string, Record<string, unknown>>();
    for (const ref of walkComponents(documentSnapshot)) {
      const id = ref.component.props.id;
      if (typeof id === 'string' && !docMap.has(id)) {
        docMap.set(id, ref.component.props);
      }
    }

    // walkComponents covers content and zones only, so the root has to be
    // registered by hand or a diverged root prop is neither applied nor reported.
    const docRootProps = (documentSnapshot.root as { props?: Record<string, unknown> } | undefined)?.props;
    if (docRootProps && propConflictOptions.fromRootProps) {
      fromMap.set('__root__', propConflictOptions.fromRootProps);
      docMap.set('__root__', docRootProps);
    }

    for (const patch of propConflictOptions.propPatches) {
      const fromProps = fromMap.get(patch.componentId);
      const docProps = docMap.get(patch.componentId);
      if (!fromProps || !docProps) continue;

      for (const op of patch.operations) {
        const docValue = getNestedValue(docProps, op.path);
        const templateOldValue = getNestedValue(fromProps, op.path);
        if (!deepEqual(docValue, templateOldValue)) {
          propConflicts.push({
            componentId: patch.componentId,
            propPath: op.path,
            templateOldValue,
            templateNewValue: (op as { value?: unknown }).value,
            documentValue: docValue,
          });
        }
      }
    }
  }

  const documentUnchanged =
    documentDelta.added.length === 0 &&
    documentDelta.removed.length === 0 &&
    documentDelta.moved.length === 0;

  if (documentUnchanged && propConflicts.length === 0) {
    return null;
  }

  return {
    hasConflict: hasStructuralConflict,
    templateDelta,
    documentDelta,
    propConflicts: propConflicts.length > 0 ? propConflicts : undefined,
  };
}

/**
 * The document version_number to diff a document's own edits against: the last
 * migration-sourced version, or the document's earliest version when it has
 * never been migrated.
 */
async function resolveBaselineVersion(documentId: string, branchId: string): Promise<number> {
  const lastMigration = await query<{ version_number: number }>(
    `SELECT COALESCE(MAX(version_number), 0) as version_number
     FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2 AND source = 'migration'`,
    [documentId, branchId],
  );
  const lastMigrationVersion = lastMigration.rows[0]?.version_number ?? 0;
  if (lastMigrationVersion > 0) {
    return lastMigrationVersion;
  }

  const earliest = await query<{ version_number: number }>(
    `SELECT MIN(version_number) as version_number
     FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2`,
    [documentId, branchId],
  );
  return earliest.rows[0]?.version_number ?? 1;
}

export async function applyDeltaToDocument(
  documentId: string,
  branchId: string,
  delta: SlotDelta,
  principal: MigrationPrincipal,
  propMigration?: PropMigrationOptions,
  mainBranchId?: string,
): Promise<{ versionId: string; snapshot: Record<string, unknown> }> {
  const latestVersion = await getLatestDocumentVersion(documentId, branchId);
  let snapshot = latestVersion?.snapshot ?? null;

  // Latest version may have a null snapshot (e.g. CRDT-only edits that store
  // diffs without a full baseline). Fall back to reconstructing the snapshot.
  if (!snapshot && latestVersion) {
    snapshot = await reconstructVersionSnapshot(
      documentId, branchId, latestVersion.versionNumber,
    );
  }

  // No local version: a page inherited from main, migrated for the first time
  // here. Seed from main's latest published version so the delta applies to
  // the content the branch serves; createDocumentVersion writes it local.
  if (!snapshot && latestVersion === null) {
    snapshot = await getInheritedPublishedSnapshot(documentId, branchId, mainBranchId);
  }

  if (!snapshot) {
    throw new Error(`No snapshot found for document ${documentId} on branch ${branchId}`);
  }

  const newSnapshot = applyDeltaToSnapshot(snapshot, delta, propMigration);

  const addedIds = delta.added
    .map((add) => add.component.props.id)
    .filter((id): id is string => typeof id === 'string');
  const movedIds = delta.moved.map((move) => move.id);

  const version = await createDocumentVersion({
    documentId,
    branchId,
    snapshot: newSnapshot,
    source: 'migration',
    createdById: principal.id,
    createdByType: principal.type,
    puckActions: [{
      type: 'migration',
      addedIds,
      removedIds: [...delta.removed],
      movedIds,
      propPatchCount: propMigration?.propPatches.length ?? 0,
    }],
  });

  return { versionId: version.id, snapshot: newSnapshot };
}

export async function triggerMigration(
  siteId: string,
  branchId: string,
  templateId: string,
  fromVersion: number,
  toVersion: number,
  principal: MigrationPrincipal,
  mainBranchId?: string,
): Promise<MigrationJob> {
  if (fromVersion >= toVersion) {
    throw new InvalidVersionRangeError(fromVersion, toVersion);
  }

  const templateCheck = await query(
    'SELECT id FROM app.documents WHERE id = $1 AND archived_at IS NULL',
    [templateId],
  );
  if (templateCheck.rows.length === 0) {
    throw new TemplateNotFoundError(templateId);
  }

  // Count against this branch's effective synced_version, so a page already
  // migrated here via its per-branch override is not counted as stale again.
  const countResult = branchInheritsFromMain(branchId, mainBranchId)
    ? await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       LEFT JOIN app.document_relation_branch_sync brs
         ON brs.source_document_id = d.id AND brs.relation_type = 'template' AND brs.branch_id = $3
       WHERE dr.target_document_id = $1
         AND (COALESCE(brs.synced_version, dr.synced_version) IS NULL
              OR COALESCE(brs.synced_version, dr.synced_version) < $2)
         AND d.archived_at IS NULL`,
      [templateId, toVersion, branchId],
    )
    : await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       WHERE dr.target_document_id = $1
         AND (dr.synced_version IS NULL OR dr.synced_version < $2)
         AND d.archived_at IS NULL`,
      [templateId, toVersion],
    );
  const countRow = countResult.rows[0];
  const totalDocuments = parseInt(countRow?.count ?? '0', 10);

  const { checkpoint } = await createCheckpoint({
    branchId,
    checkpointType: 'pre_migration',
    createdById: principal.id,
    createdByType: principal.type,
    name: `Pre-migration checkpoint: template ${templateId} v${String(fromVersion)}→v${String(toVersion)}`,
    forceFullSnapshot: true,
  });

  const jobResult = await query<MigrationJobRow>(
    `INSERT INTO app.migration_jobs (
       site_id, branch_id, template_id, from_version, to_version,
       checkpoint_id, status, total_documents,
       created_by_id, created_by_type
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
     RETURNING *`,
    [siteId, branchId, templateId, fromVersion, toVersion,
      checkpoint.id, totalDocuments, principal.id, principal.type],
  );

  const triggerJobRow = jobResult.rows[0];
  if (!triggerJobRow) {
    throw new Error('Failed to create migration job');
  }
  return mapRowToJob(triggerJobRow);
}

/**
 * Builds the prop-migration options from the template's `from` version, or
 * `undefined` when the version range changed no props.
 */
async function buildPropMigrationOptions(
  templateId: string,
  branchId: string,
  fromVersion: number,
  propPatches: PropPatch[],
): Promise<PropMigrationOptions | undefined> {
  if (propPatches.length === 0) {
    return undefined;
  }
  const fromTemplateSnapshot = await reconstructVersionSnapshot(templateId, branchId, fromVersion);
  const fromContent = Array.isArray(fromTemplateSnapshot?.content)
    ? fromTemplateSnapshot.content as { type?: string; props?: Record<string, unknown> }[]
    : [];
  const fromRootProps =
    (fromTemplateSnapshot?.root as { props?: Record<string, unknown> } | undefined)?.props ?? {};
  type ZoneComponents = { type?: string; props?: Record<string, unknown> }[];
  const fromZones = fromTemplateSnapshot?.zones as Record<string, ZoneComponents> | undefined;

  return {
    propPatches,
    fromTemplateContent: fromContent,
    fromRootProps,
    fromZones,
  };
}

export async function processMigration(
  jobId: string,
  onDocumentsMigrated?: (siteId: string, branchId: string, documentIds: string[]) => Promise<void>,
  mainBranchId?: string,
): Promise<{ processedDocuments: number; conflictedDocuments: number }> {
  const job = await getMigrationJob(jobId);

  const claimResult = await query(
    'UPDATE app.migration_jobs SET status = \'in_progress\' WHERE id = $1 AND status = \'pending\'',
    [jobId],
  );
  if ((claimResult.rowCount ?? 0) === 0) {
    throw new Error(`Migration job ${jobId} is not in pending state (possible concurrent execution)`);
  }

  const migrationDelta = await extractTemplateDelta(
    job.templateId, job.branchId, job.fromVersion, job.toVersion, mainBranchId,
  );
  const templateDelta = migrationDelta.slotDelta;

  // Read the template from main when this branch inherits it rather than having
  // edited it locally.
  const templateReadBranchId = await resolveTemplateReadBranch(job.templateId, job.branchId, mainBranchId);
  const propMigration = await buildPropMigrationOptions(
    job.templateId, templateReadBranchId, job.fromVersion, migrationDelta.propPatches,
  );

  const useSyncOverride = branchInheritsFromMain(job.branchId, mainBranchId);

  let processedDocuments = 0;
  let conflictedDocuments = 0;
  let offset = 0;
  const batchSize = 50;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const docs = await findAffectedDocuments(
      job.siteId, job.branchId, job.templateId, job.toVersion, batchSize, offset, mainBranchId,
    );

    if (docs.length === 0) break;

    const cleanDocumentIds: string[] = [];

    for (const doc of docs) {
      const conflict = await detectDocumentConflicts(
        doc.id, job.branchId, templateDelta, doc.snapshot, propMigration,
      );

      if (conflict?.hasConflict === true) {
        await query(
          `INSERT INTO app.migration_conflicts (
             migration_job_id, document_id, branch_id, template_id,
             from_version, to_version, template_delta, document_actions, conflict_type
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [jobId, doc.id, job.branchId, job.templateId,
            job.fromVersion, job.toVersion,
            templateDelta, conflict.documentDelta, 'structural'],
        );
        conflictedDocuments++;
      } else {
        try {
          // The delta application, any prop-divergence record, and the
          // synced_version advance commit together: a document is never left
          // migrated-but-unadvanced, so a re-run can never apply the delta twice.
          await withTransaction(async () => {
            await applyDeltaToDocument(
              doc.id, job.branchId, templateDelta,
              { id: job.createdById, type: job.createdByType },
              propMigration,
              mainBranchId,
            );

            // The document's clean changes are applied; a diverged prop is left
            // local and recorded so the operator decides template vs. local.
            if (conflict?.propConflicts && conflict.propConflicts.length > 0) {
              await query(
                `INSERT INTO app.migration_conflicts (
                   migration_job_id, document_id, branch_id, template_id,
                   from_version, to_version, template_delta, document_actions,
                   prop_conflicts, conflict_type
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
                [jobId, doc.id, job.branchId, job.templateId,
                  job.fromVersion, job.toVersion,
                  templateDelta, conflict.documentDelta,
                  JSON.stringify(conflict.propConflicts), 'prop'],
              );
            }

            await advanceSyncedVersion(doc.id, job.branchId, job.toVersion, useSyncOverride);
          });

          if (conflict?.propConflicts && conflict.propConflicts.length > 0) {
            conflictedDocuments++;
          }
          cleanDocumentIds.push(doc.id);
        } catch (applyErr: unknown) {
          console.error(`Migration: failed to apply delta to document ${doc.id}:`, applyErr);
          await query(
            `INSERT INTO app.migration_conflicts (
               migration_job_id, document_id, branch_id, template_id,
               from_version, to_version, template_delta, document_actions, conflict_type
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [jobId, doc.id, job.branchId, job.templateId,
              job.fromVersion, job.toVersion,
              templateDelta, { error: String(applyErr) }, 'structural'],
          );
          conflictedDocuments++;
        }
      }

      processedDocuments++;
    }

    // Notify DOs to reload from Postgres so they pick up the migrated snapshots
    if (cleanDocumentIds.length > 0 && onDocumentsMigrated) {
      try {
        await onDocumentsMigrated(job.siteId, job.branchId, cleanDocumentIds);
      } catch (notifyErr: unknown) {
        console.error('Migration: failed to notify DOs:', notifyErr);
      }
    }

    await query(
      'UPDATE app.migration_jobs SET processed_documents = $1 WHERE id = $2',
      [processedDocuments, jobId],
    );

    offset += docs.length - cleanDocumentIds.length;
  }

  const finalStatus = conflictedDocuments > 0 ? 'completed_with_conflicts' : 'completed';
  await query(
    'UPDATE app.migration_jobs SET status = $1, completed_at = NOW() WHERE id = $2',
    [finalStatus, jobId],
  );

  return { processedDocuments, conflictedDocuments };
}

export async function rollbackMigration(
  jobId: string,
  principal: MigrationPrincipal,
  ownership?: { siteId: string; branchId: string; templateId: string },
  mainBranchId?: string,
): Promise<{ rolledBackDocuments: number }> {
  const job = await getMigrationJob(jobId);

  if (ownership) {
    const siteMatch = job.siteId === ownership.siteId;
    const branchMatch = job.branchId === ownership.branchId;
    const templateMatch = job.templateId === ownership.templateId;
    if (!siteMatch || !branchMatch || !templateMatch) {
      throw new MigrationJobNotFoundError(jobId);
    }
  }

  const useSyncOverride = branchInheritsFromMain(job.branchId, mainBranchId);
  let rolledBackDocuments = 0;

  if (job.checkpointId !== null && job.checkpointId !== '') {
    // A page inherited from main gains its first local version during the
    // migration, so it is absent from the pre-migration checkpoint and the
    // revert below leaves it untouched. Drop those migration versions before
    // the revert snapshots the branch — afterwards the revert's own checkpoint
    // would reference them — so the page falls back to inheriting main.
    let inheritedReverted = 0;
    if (useSyncOverride) {
      const inheritedRevert = await query(
        `DELETE FROM app.document_versions dv
         WHERE dv.branch_id = $2
           AND dv.source = 'migration'
           AND dv.created_at >= $3
           AND dv.document_id IN (
             SELECT source_document_id FROM app.document_relations
             WHERE target_document_id = $1 AND relation_type = 'template'
           )
           AND NOT EXISTS (
             SELECT 1 FROM app.checkpoint_documents cd
             WHERE cd.checkpoint_id = $4 AND cd.document_id = dv.document_id
           )`,
        [job.templateId, job.branchId, job.createdAt.toISOString(), job.checkpointId],
      );
      inheritedReverted = inheritedRevert.rowCount ?? 0;
    }

    const result = await revertToCheckpoint({
      checkpointId: job.checkpointId,
      createdById: principal.id,
      createdByType: principal.type,
    });
    rolledBackDocuments = result.documentsReverted + inheritedReverted;
  } else {
    const deleteResult = await query(
      `DELETE FROM app.document_versions
       WHERE source = 'migration'
         AND document_id IN (
           SELECT source_document_id FROM app.document_relations
           WHERE target_document_id = $1 AND relation_type = 'template'
         )
         AND branch_id = $2
         AND created_at >= $3`,
      [job.templateId, job.branchId, job.createdAt.toISOString()],
    );
    rolledBackDocuments = deleteResult.rowCount ?? 0;
  }

  // Reset only what the migration advanced: a branch that inherits the edge
  // advanced its per-branch override, so roll that back and leave the shared
  // base — main's version — untouched.
  if (useSyncOverride) {
    await query(
      `UPDATE app.document_relation_branch_sync brs SET synced_version = $1, updated_at = NOW()
       FROM app.document_relations dr
       WHERE brs.source_document_id = dr.source_document_id
         AND brs.relation_type = 'template' AND dr.relation_type = 'template'
         AND dr.target_document_id = $2
         AND brs.branch_id = $4 AND brs.synced_version = $3`,
      [job.fromVersion, job.templateId, job.toVersion, job.branchId],
    );
  } else {
    await query(
      `UPDATE app.document_relations dr SET synced_version = $1
       FROM app.documents d
       WHERE dr.source_document_id = d.id
         AND dr.target_document_id = $2 AND dr.synced_version = $3
         AND dr.relation_type = 'template' AND d.archived_at IS NULL`,
      [job.fromVersion, job.templateId, job.toVersion],
    );
  }

  await query(
    'UPDATE app.migration_jobs SET status = \'failed\' WHERE id = $1',
    [jobId],
  );

  return { rolledBackDocuments };
}

/**
 * Preview what a migration would do without applying any changes.
 * Returns a summary of affected documents and estimated conflicts,
 * with optional per-document detail.
 */
export async function previewMigration(
  siteId: string,
  branchId: string,
  templateId: string,
  fromVersion: number,
  toVersion: number,
  detail = false,
  mainBranchId?: string,
): Promise<MigrationPreview> {
  if (fromVersion >= toVersion) {
    throw new InvalidVersionRangeError(fromVersion, toVersion);
  }

  const templateCheck = await query(
    'SELECT id FROM app.documents WHERE id = $1 AND archived_at IS NULL',
    [templateId],
  );
  if (templateCheck.rows.length === 0) {
    throw new TemplateNotFoundError(templateId);
  }

  const migrationDelta = await extractTemplateDelta(templateId, branchId, fromVersion, toVersion, mainBranchId);
  const templateDelta = migrationDelta.slotDelta;
  // Read the template from main when this branch inherits it rather than having
  // edited it locally.
  const templateReadBranchId = await resolveTemplateReadBranch(templateId, branchId, mainBranchId);
  const propMigration = await buildPropMigrationOptions(
    templateId, templateReadBranchId, fromVersion, migrationDelta.propPatches,
  );

  const previewDocuments: MigrationPreviewDocument[] = [];
  let affectedDocuments = 0;
  let estimatedConflicts = 0;
  let offset = 0;
  const batchSize = 50;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const docs = await findAffectedDocuments(
      siteId, branchId, templateId, toVersion, batchSize, offset, mainBranchId,
    );

    if (docs.length === 0) break;

    for (const doc of docs) {
      affectedDocuments++;

      const conflict = await detectDocumentConflicts(
        doc.id, branchId, templateDelta, doc.snapshot, propMigration,
      );

      const hasStructuralConflict = conflict?.hasConflict ?? false;
      const propConflicts = conflict?.propConflicts ?? [];

      if (hasStructuralConflict || propConflicts.length > 0) {
        estimatedConflicts++;
      }

      if (detail) {
        const previewDoc: MigrationPreviewDocument = {
          documentId: doc.id,
          path: doc.path,
          currentTemplateVersion: doc.templateVersion,
          applied: !hasStructuralConflict,
          // A structural conflict holds the whole document, so its diverged
          // props are not applied and not offered for review, matching the
          // migration itself.
          propConflicts: hasStructuralConflict ? [] : propConflicts,
          hasConflict: hasStructuralConflict,
        };

        if (hasStructuralConflict && conflict) {
          previewDoc.structuralConflict = {
            templateDelta: conflict.templateDelta,
            documentDelta: conflict.documentDelta,
          };
        } else {
          previewDoc.proposedSnapshot = applyDeltaToSnapshot(doc.snapshot, templateDelta, propMigration);
        }

        previewDocuments.push(previewDoc);
      }
    }

    offset += batchSize;
  }

  const cleanDocuments = affectedDocuments - estimatedConflicts;

  const preview: MigrationPreview = {
    templateId,
    fromVersion,
    toVersion,
    templateDelta,
    propChangeCount: migrationDelta.propPatches.length,
    affectedDocuments,
    estimatedConflicts,
    cleanDocuments,
  };

  if (detail) {
    preview.documents = previewDocuments;
  }

  return preview;
}

/**
 * Progress and conflict state for the migration a template is currently
 * running or awaiting conflict resolution on.
 */
export interface ActiveMigration {
  jobId: string;
  status: string;
  processedDocuments: number;
  totalDocuments: number;
  unresolvedConflicts: number;
}

/**
 * Migration status summary for a template on a branch.
 */
export interface MigrationStatus {
  templateId: string;
  currentVersion: number;
  staleDocumentCount: number;
  oldestDocumentVersion: number | null;
  migrationAvailable: boolean;
  activeMigration: ActiveMigration | null;
}

/**
 * Get the migration status for a template on a branch.
 * Returns the current template version, count of stale documents,
 * and the oldest document version still referencing the template.
 */
export async function getMigrationStatus(
  templateId: string,
  branchId: string,
  mainBranchId?: string,
): Promise<MigrationStatus> {
  // Get the latest version number of the template document, resolving against
  // main when this branch inherits the template rather than editing it locally.
  const templateReadBranchId = await resolveTemplateReadBranch(templateId, branchId, mainBranchId);
  const versionResult = await query<{ version_number: number }>(
    `SELECT version_number FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2
     ORDER BY version_number DESC LIMIT 1`,
    [templateId, templateReadBranchId],
  );

  const versionRow = versionResult.rows[0];
  if (!versionRow) {
    throw new TemplateNotFoundError(templateId);
  }

  const currentVersion = versionRow.version_number;

  // Count stale documents and find the oldest version, resolving each edge's
  // synced_version against this branch's override when it inherits the edge.
  const staleResult = branchInheritsFromMain(branchId, mainBranchId)
    ? await query<{ count: string; oldest_version: number | null }>(
      `SELECT COUNT(*) as count, MIN(COALESCE(brs.synced_version, dr.synced_version, 0)) as oldest_version
       FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       LEFT JOIN app.document_relation_branch_sync brs
         ON brs.source_document_id = d.id AND brs.relation_type = 'template' AND brs.branch_id = $3
       WHERE dr.target_document_id = $1
         AND (COALESCE(brs.synced_version, dr.synced_version) IS NULL
              OR COALESCE(brs.synced_version, dr.synced_version) < $2)
         AND d.archived_at IS NULL`,
      [templateId, currentVersion, branchId],
    )
    : await query<{ count: string; oldest_version: number | null }>(
      `SELECT COUNT(*) as count, MIN(COALESCE(dr.synced_version, 0)) as oldest_version
       FROM app.documents d
       ${TEMPLATE_RELATION_INNER_JOIN}
       WHERE dr.target_document_id = $1
         AND (dr.synced_version IS NULL OR dr.synced_version < $2)
         AND d.archived_at IS NULL`,
      [templateId, currentVersion],
    );

  const staleRow = staleResult.rows[0];
  const staleDocumentCount = parseInt(staleRow?.count ?? '0', 10);
  const oldestDocumentVersion = staleRow?.oldest_version ?? null;

  const activeMigration = await getActiveMigration(templateId, branchId);

  return {
    templateId,
    currentVersion,
    staleDocumentCount,
    oldestDocumentVersion,
    migrationAvailable: staleDocumentCount > 0,
    activeMigration,
  };
}

/**
 * Resolve the migration a template is still working through: the latest job
 * that is either running (pending, in_progress) or completed with conflicts
 * that remain unresolved. Returns null when the latest job is cleanly
 * completed, failed, or has had all conflicts resolved.
 */
async function getActiveMigration(
  templateId: string,
  branchId: string,
): Promise<ActiveMigration | null> {
  const jobResult = await query<MigrationJobRow>(
    `SELECT * FROM app.migration_jobs
     WHERE template_id = $1 AND branch_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [templateId, branchId],
  );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const latestJobRow = jobResult?.rows[0];
  if (!latestJobRow) {
    return null;
  }

  const job = mapRowToJob(latestJobRow);

  const conflictResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM app.migration_conflicts
     WHERE migration_job_id = $1 AND resolution IS NULL`,
    [job.id],
  );
  const conflictCountRow = conflictResult.rows[0];
  const unresolvedConflicts = parseInt(conflictCountRow?.count ?? '0', 10);

  const isRunning = job.status === 'pending' || job.status === 'in_progress';
  const awaitingResolution = job.status === 'completed_with_conflicts' && unresolvedConflicts > 0;

  if (!isRunning && !awaitingResolution) {
    return null;
  }

  return {
    jobId: job.id,
    status: job.status,
    processedDocuments: job.processedDocuments,
    totalDocuments: job.totalDocuments,
    unresolvedConflicts,
  };
}

/**
 * Resolves a prop conflict by taking the template value: sets each diverged
 * prop to its `templateNewValue` on the document's current snapshot and writes
 * a migration-sourced version. The structural delta was applied at migration
 * time, so it is not replayed here.
 */
async function applyPropConflictResolution(
  conflict: MigrationConflictRow,
  principal: MigrationPrincipal,
): Promise<void> {
  const propConflicts = parsePropConflictsColumn(conflict.prop_conflicts);
  if (propConflicts.length === 0) {
    return;
  }

  const latest = await getLatestDocumentVersion(conflict.document_id, conflict.branch_id);
  let snapshot = latest?.snapshot ?? null;
  if (!snapshot && latest) {
    snapshot = await reconstructVersionSnapshot(
      conflict.document_id, conflict.branch_id, latest.versionNumber,
    );
  }
  if (!snapshot) {
    throw new Error(`No snapshot found for document ${conflict.document_id} on branch ${conflict.branch_id}`);
  }

  const updated = structuredClone(snapshot);
  const refs = walkComponents(updated);
  for (const pc of propConflicts) {
    // walkComponents covers content and zones only, so the root is targeted
    // directly rather than searched for among the components.
    const target = pc.componentId === '__root__'
      ? (updated.root as { props?: Record<string, unknown> } | undefined)?.props
      : refs.find((r) => r.component.props.id === pc.componentId)?.component.props;
    if (target) {
      applyPropOp(target, { op: 'replace', path: pc.propPath, value: pc.templateNewValue });
    }
  }

  await createDocumentVersion({
    documentId: conflict.document_id,
    branchId: conflict.branch_id,
    snapshot: updated,
    source: 'migration',
    createdById: principal.id,
    createdByType: principal.type,
    puckActions: [{ type: 'migration', addedIds: [], removedIds: [], movedIds: [], propPatchCount: propConflicts.length }],
  });
}

export async function resolveMigrationConflict(
  conflictId: string,
  resolution: 'apply' | 'skip' | 'manual',
  principal: MigrationPrincipal,
  expectedJobId?: string,
  mainBranchId?: string,
): Promise<MigrationConflict> {
  // Reconstruct the structural-apply inputs before locking. Template versions
  // are immutable history, so building the delta and prop migration outside the
  // transaction keeps the conflict-row lock scoped to the read-guard-write path
  // instead of spanning version reconstruction.
  let structuralPlan: { delta: SlotDelta; propMigration?: PropMigrationOptions } | undefined;
  if (resolution === 'apply') {
    const initial = await query<MigrationConflictRow>(
      'SELECT * FROM app.migration_conflicts WHERE id = $1',
      [conflictId],
    );
    const conflict = initial.rows[0];
    if (conflict === undefined) {
      throw new Error(`Migration conflict with ID "${conflictId}" not found.`);
    }

    if (conflict.conflict_type !== 'prop') {
      // A delta can come back from jsonb as a JSON string rather than a parsed
      // value; parse it before validating.
      const rawDelta: unknown = typeof conflict.template_delta === 'string'
        ? JSON.parse(conflict.template_delta)
        : conflict.template_delta;
      if (!isSlotDelta(rawDelta)) {
        throw new LegacyConflictDeltaError(conflictId);
      }

      const fromSnapshot = await reconstructVersionSnapshot(
        conflict.template_id, conflict.branch_id, conflict.from_version,
      );
      const toSnapshot = await reconstructVersionSnapshot(
        conflict.template_id, conflict.branch_id, conflict.to_version,
      );
      const propPatches = extractPropPatches(fromSnapshot, toSnapshot);

      let propMigration: PropMigrationOptions | undefined;
      if (propPatches.length > 0) {
        const fromContent = Array.isArray(fromSnapshot?.content)
          ? fromSnapshot.content as { type?: string; props?: Record<string, unknown> }[]
          : [];
        const fromRootProps =
          (fromSnapshot?.root as { props?: Record<string, unknown> } | undefined)?.props ?? {};
        type ZoneComponents = { type?: string; props?: Record<string, unknown> }[];
        const fromZones = fromSnapshot?.zones as Record<string, ZoneComponents> | undefined;

        propMigration = {
          propPatches,
          fromTemplateContent: fromContent,
          fromRootProps,
          fromZones,
        };
      }

      structuralPlan = { delta: rawDelta, propMigration };
    }
  }

  return withTransaction(async () => {
    const conflictResult = await query<MigrationConflictRow>(
      'SELECT * FROM app.migration_conflicts WHERE id = $1 FOR UPDATE',
      [conflictId],
    );

    const conflict = conflictResult.rows[0];
    if (conflict === undefined) {
      throw new Error(`Migration conflict with ID "${conflictId}" not found.`);
    }

    if (expectedJobId !== undefined && expectedJobId !== '' && conflict.migration_job_id !== expectedJobId) {
      throw new MigrationJobNotFoundError(expectedJobId);
    }

    // The row lock above serialises concurrent resolutions. A repeat of the same
    // resolution is an idempotent no-op returning the settled record; a request
    // for a different resolution is rejected rather than silently discarded or
    // applied on top of the prior outcome.
    if (conflict.resolution !== null && conflict.resolution !== '') {
      if (conflict.resolution === resolution) {
        return mapRowToConflict(conflict);
      }
      throw new ConflictAlreadyResolvedError(conflictId, conflict.resolution);
    }

    if (resolution === 'apply' && conflict.conflict_type === 'prop') {
      // The structural changes were already applied at migration time; taking the
      // template value here only sets the diverged props on the current snapshot.
      await applyPropConflictResolution(conflict, principal);
    } else if (resolution === 'apply' && structuralPlan) {
      await applyDeltaToDocument(
        conflict.document_id,
        conflict.branch_id,
        structuralPlan.delta,
        principal,
        structuralPlan.propMigration,
        mainBranchId,
      );

      await advanceSyncedVersion(
        conflict.document_id,
        conflict.branch_id,
        conflict.to_version,
        branchInheritsFromMain(conflict.branch_id, mainBranchId),
      );
    }

    const updateResult = await query<MigrationConflictRow>(
      `UPDATE app.migration_conflicts
       SET resolution = $1, resolved_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [resolution, conflictId],
    );

    const resolved = updateResult.rows[0];
    if (resolved === undefined) {
      throw new Error(`Migration conflict with ID "${conflictId}" not found.`);
    }
    return mapRowToConflict(resolved);
  });
}
