/**
 * Phase 5: Migration Service
 *
 * Handles automatic document updates when templates change (PROPOSAL-010).
 * Provides conflict detection and rollback capabilities for template migrations.
 *
 * Key operations:
 * - Trigger migration jobs with pre-migration checkpoints
 * - Detect structural conflicts between template changes and document edits
 * - Apply template deltas to document snapshots
 * - Rollback failed migrations using checkpoints
 *
 * @see proposals/PROPOSAL-010-content-types-and-template-migration.md
 */

import { compare as jsonPatchCompare, type Operation } from 'fast-json-patch';
import { query } from '../db';
import { createCheckpoint, revertToCheckpoint } from './checkpoint-service';
import { getLatestDocumentVersion, createDocumentVersion, reconstructVersionSnapshot } from './document-version-service';
import { TEMPLATE_RELATION_INNER_JOIN } from './document-queries';

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
  documentActions: unknown;
  resolution: 'apply' | 'skip' | 'manual' | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/**
 * Puck action from action_metadata.puckActions.
 * Represents structural changes (reorder, move, insert, delete).
 */
export interface PuckAction {
  type: 'reorder' | 'move' | 'insert' | 'delete' | 'migration' | 'snapshot_sync';
  sourceIndex?: number;
  destinationIndex?: number;
  componentType?: string;
  zone?: string;
  fromVersion?: number;
  toVersion?: number;
  [key: string]: unknown;
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
 * Combined migration delta: structural actions plus prop-level patches.
 */
export interface MigrationDelta {
  structuralActions: PuckAction[];
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
 * Conflict detection result.
 */
export interface ConflictResult {
  hasConflict: boolean;
  templateDelta: PuckAction[];
  documentActions: PuckAction[];
  propConflicts?: PropConflict[];
}

/**
 * Per-document preview result for migration preview.
 */
export interface MigrationPreviewDocument {
  documentId: string;
  path: string;
  currentTemplateVersion: number | null;
  hasConflict: boolean;
  proposedSnapshot?: Record<string, unknown>;
  conflictDetails?: {
    templateDelta: PuckAction[];
    documentActions: PuckAction[];
  };
}

/**
 * Migration preview result. Summarises what a migration would do
 * without applying any changes.
 */
export interface MigrationPreview {
  templateId: string;
  fromVersion: number;
  toVersion: number;
  templateDelta: PuckAction[];
  // Count of prop-level default changes, which are applied but not represented
  // in templateDelta (that carries structural actions only).
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
    documentActions: row.document_actions,
    resolution: row.resolution as MigrationConflict['resolution'],
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at !== null && row.resolved_at !== '' ? new Date(row.resolved_at) : null,
  };
}

// =============================================================================
// Delta Application Helpers
// =============================================================================

/**
 * Apply structural actions to a document snapshot.
 *
 * @param snapshot - The document's current snapshot
 * @param delta - Structural puckActions to replay
 * @param templateContent - The template's content array at toVersion, used to
 *   look up full component data for insert actions (type + props + defaults).
 *   Without this, inserts create empty shell components.
 */
export function applyDeltaToSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  delta: PuckAction[],
  templateContent?: unknown[],
  propMigration?: PropMigrationOptions,
): Record<string, unknown> {
  if (!snapshot) {
    return {};
  }
  const content = Array.isArray(snapshot.content)
    ? [...(snapshot.content as unknown[])]
    : [];

  // Index template components by type+index for insert lookups
  const templateByTypeIndex = new Map<string, unknown>();
  if (templateContent) {
    templateContent.forEach((c, i) => {
      const comp = c as { type?: string };
      if (comp.type !== undefined && comp.type !== '') {
        templateByTypeIndex.set(`${comp.type}:${String(i)}`, c);
      }
    });
  }

  // Index existing component IDs to prevent duplicate inserts
  const existingIds = new Set<string>();
  for (const c of content) {
    const comp = c as { props?: { id?: string } };
    if (comp.props?.id !== undefined && comp.props.id !== '') existingIds.add(comp.props.id);
  }

  for (const action of delta) {
    if (action.type === 'reorder' && action.sourceIndex != null && action.destinationIndex != null) {
      if (action.sourceIndex < 0 || action.sourceIndex >= content.length) continue;
      const [item] = content.splice(action.sourceIndex, 1);
      content.splice(action.destinationIndex, 0, item);
    } else if (action.type === 'insert') {
      // Look up the full component from the template snapshot
      const componentType = action.componentType ?? 'Unknown';
      const destIndex = action.destinationIndex;
      const templateComponent = destIndex != null
        ? templateByTypeIndex.get(`${componentType}:${String(destIndex)}`)
        : undefined;

      const newComponent = templateComponent ?? {
        type: componentType,
        props: { id: 'migrated-' + crypto.randomUUID() },
      };

      // Skip if this component already exists in the document
      const compId = (newComponent as { props?: { id?: string } }).props?.id;
      if (compId !== undefined && compId !== '' && existingIds.has(compId)) {
        continue;
      }
      if (compId !== undefined && compId !== '') existingIds.add(compId);

      if (destIndex != null) {
        content.splice(destIndex, 0, newComponent);
      } else {
        content.push(newComponent);
      }
    } else if (action.type === 'delete' && action.sourceIndex != null) {
      content.splice(action.sourceIndex, 1);
    } else if (action.type === 'move' && action.sourceIndex != null && action.destinationIndex != null) {
      if (action.sourceIndex < 0 || action.sourceIndex >= content.length) continue;
      const [item] = content.splice(action.sourceIndex, 1);
      content.splice(action.destinationIndex, 0, item);
    } else if (action.type === 'snapshot_sync') {
      const fromContent = action.fromContent as ComponentLike[] | undefined;
      const toContent = action.toContent as ComponentLike[] | undefined;
      if (fromContent && toContent) {
        const fromIds = new Set(fromContent.map(c => c.props?.id).filter(Boolean));
        const toIds = new Set(toContent.map(c => c.props?.id).filter(Boolean));

        for (let i = content.length - 1; i >= 0; i--) {
          const comp = content[i] as ComponentLike;
          const compId = comp.props?.id;
          if (typeof compId === 'string' && fromIds.has(compId) && !toIds.has(compId)) {
            content.splice(i, 1);
          }
        }

        const getCompId = (comp: unknown): string | undefined =>
          (comp as ComponentLike).props?.id as string | undefined;

        const anchors = new Map<string, string | null>();
        let lastTemplateId: string | null = null;
        for (const comp of content) {
          const compId = getCompId(comp);
          if (typeof compId === 'string' && (toIds.has(compId) || fromIds.has(compId))) {
            lastTemplateId = compId;
          } else {
            const anchorKey = compId ?? `__noId_${String(content.indexOf(comp))}`;
            anchors.set(anchorKey, lastTemplateId);
          }
        }

        const docById = new Map<string, unknown>();
        for (const comp of content) {
          const compId = getCompId(comp);
          if (typeof compId === 'string') docById.set(compId, comp);
        }

        const reordered: unknown[] = [];
        const placed = new Set<string>();

        for (const comp of content) {
          const compId = getCompId(comp);
          const anchorKey = compId ?? `__noId_${String(content.indexOf(comp))}`;
          const isDocSpecific = typeof compId !== 'string'
            || (!toIds.has(compId) && !fromIds.has(compId));
          if (isDocSpecific && anchors.get(anchorKey) === null) {
            reordered.push(comp);
            if (typeof compId === 'string') placed.add(compId);
            placed.add(anchorKey);
          }
        }

        for (const toComp of toContent) {
          const toId = toComp.props?.id;
          if (typeof toId !== 'string') continue;

          const docComp = docById.get(toId);
          if (docComp !== undefined) {
            reordered.push(docComp);
            placed.add(toId);
          } else if (!fromIds.has(toId)) {
            reordered.push(toComp);
            placed.add(toId);
          }

          for (const comp of content) {
            const cId = getCompId(comp);
            const anchorKey = cId ?? `__noId_${String(content.indexOf(comp))}`;
            if (!placed.has(anchorKey) && anchors.get(anchorKey) === toId) {
              reordered.push(comp);
              if (typeof cId === 'string') placed.add(cId);
              placed.add(anchorKey);
            }
          }
        }

        for (const comp of content) {
          const cId = getCompId(comp);
          const anchorKey = cId ?? `__noId_${String(content.indexOf(comp))}`;
          if (!placed.has(anchorKey)
            && (typeof cId === 'string' ? !placed.has(cId) : true)) {
            reordered.push(comp);
          }
        }

        content.length = 0;
        content.push(...reordered);
      }
    }
  }

  // Apply prop patches (three-way merge)
  let resultRoot = snapshot.root as { props?: Record<string, unknown> } | undefined;
  let resultZones = snapshot.zones as Record<string, unknown[]> | undefined;

  if (propMigration && propMigration.propPatches.length > 0) {
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
        if (!resultRoot?.props || !propMigration.fromRootProps) continue;
        const rootProps = { ...resultRoot.props };
        for (const op of patch.operations) {
          const propKey = op.path.replace(/^\//, '');
          const docValue = rootProps[propKey];
          const templateOldValue = propMigration.fromRootProps[propKey];
          if (deepEqual(docValue, templateOldValue) && op.op === 'replace') {
            rootProps[propKey] = (op as { value: unknown }).value;
          }
        }
        resultRoot = { ...resultRoot, props: rootProps };
        continue;
      }

      // Find component in content[]
      let found = false;
      for (let i = 0; i < content.length; i++) {
        const comp = content[i] as ComponentLike;
        if (comp.props?.id === patch.componentId) {
          const fromProps = fromContentMap.get(patch.componentId) ?? fromZonesMap.get(patch.componentId);
          if (!fromProps) break;
          const props = { ...comp.props };
          for (const op of patch.operations) {
            const docValue = getNestedValue(props, op.path);
            const templateOldValue = getNestedValue(fromProps, op.path);
            if (deepEqual(docValue, templateOldValue)) {
              applyPropOp(props, op);
            }
          }
          content[i] = { ...comp, props };
          found = true;
          break;
        }
      }

      if (found) continue;

      // Find component in zones
      if (resultZones) {
        const zonesCopy = { ...resultZones };
        for (const [zoneKey, zoneContent] of Object.entries(zonesCopy)) {
          const zoneArr = [...zoneContent] as ComponentLike[];
          for (let i = 0; i < zoneArr.length; i++) {
            if (zoneArr[i].props?.id === patch.componentId) {
              const fromProps = fromZonesMap.get(patch.componentId) ?? fromContentMap.get(patch.componentId);
              if (!fromProps) break;
              const props = { ...(zoneArr[i].props ?? {}) };
              for (const op of patch.operations) {
                const docValue = getNestedValue(props, op.path);
                const templateOldValue = getNestedValue(fromProps, op.path);
                if (deepEqual(docValue, templateOldValue)) {
                  applyPropOp(props, op);
                }
              }
              zoneArr[i] = { ...zoneArr[i], props };
              zonesCopy[zoneKey] = zoneArr;
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) resultZones = zonesCopy;
      }
    }
  }

  const result: Record<string, unknown> = { ...snapshot, content };
  if (resultRoot !== undefined) result.root = resultRoot;
  if (resultZones !== undefined) result.zones = resultZones;
  return result;
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
    }
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('/');
  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined) return;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segments[i]];
    }
  }
  if (current !== null && current !== undefined && typeof current === 'object') {
    (current as Record<string, unknown>)[segments[segments.length - 1]] = value;
  }
}

function extractComponentTypes(action: PuckAction): string[] {
  const types: string[] = [];
  if (typeof action.componentType === 'string') {
    types.push(action.componentType);
  }
  return types;
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
  const fromRoot = stripEditorPrivateRootProps(
    (fromSnapshot.root as { props?: Record<string, unknown> } | undefined)?.props,
  );
  const toRoot = stripEditorPrivateRootProps(
    (toSnapshot.root as { props?: Record<string, unknown> } | undefined)?.props,
  );
  if (fromRoot && toRoot && !deepEqual(fromRoot, toRoot)) {
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

export async function extractTemplateDelta(
  templateId: string,
  branchId: string,
  fromVersion: number,
  toVersion: number,
): Promise<MigrationDelta> {
  // Query structural versions for explicit puckActions
  const result = await query<{ action_metadata: { puckActions?: PuckAction[] } | null }>(
    `SELECT action_metadata
     FROM app.document_versions
     WHERE document_id = $1
       AND branch_id = $2
       AND version_number > $3
       AND version_number <= $4
       AND action_type = 'structural'
     ORDER BY version_number ASC`,
    [templateId, branchId, fromVersion, toVersion],
  );

  const puckActions = result.rows.flatMap(
    (r) => r.action_metadata?.puckActions ?? [],
  );

  // Always reconstruct snapshots to extract prop patches
  const fromSnapshot = await reconstructVersionSnapshot(templateId, branchId, fromVersion);
  const toSnapshot = await reconstructVersionSnapshot(templateId, branchId, toVersion);

  const propPatches = extractPropPatches(fromSnapshot, toSnapshot);

  // Determine structural actions
  let structuralActions: PuckAction[];

  if (puckActions.length > 0) {
    structuralActions = puckActions;
  } else if (result.rows.length > 0) {
    // Structural versions exist but had no explicit puckActions (derived);
    // fall back to snapshot_sync if content actually changed
    const fromContent = Array.isArray(fromSnapshot?.content)
      ? fromSnapshot.content as unknown[]
      : [];
    const toContent = Array.isArray(toSnapshot?.content)
      ? toSnapshot.content as unknown[]
      : [];

    if (JSON.stringify(fromContent) !== JSON.stringify(toContent)) {
      structuralActions = [{ type: 'snapshot_sync', fromContent, toContent }];
    } else {
      structuralActions = [];
    }
  } else {
    structuralActions = [];
  }

  return { structuralActions, propPatches };
}

export async function getMigrationJob(jobId: string): Promise<MigrationJob> {
  const result = await query<MigrationJobRow>(
    'SELECT * FROM app.migration_jobs WHERE id = $1',
    [jobId],
  );

  if (result.rows.length === 0) {
    throw new MigrationJobNotFoundError(jobId);
  }

  return mapRowToJob(result.rows[0]);
}

export async function listMigrationConflicts(jobId: string): Promise<MigrationConflict[]> {
  const result = await query<MigrationConflictRow>(
    'SELECT * FROM app.migration_conflicts WHERE migration_job_id = $1 ORDER BY created_at ASC',
    [jobId],
  );

  return result.rows.map(mapRowToConflict);
}

export async function findAffectedDocuments(
  siteId: string,
  branchId: string,
  templateId: string,
  toVersion: number,
  limit: number,
  offset: number,
): Promise<DocumentWithSnapshot[]> {
  const result = await query<{
    id: string;
    site_id: string;
    path: string;
    template_id: string | null;
    template_version: number | null;
    snapshot: Record<string, unknown>;
  }>(
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
  );

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
  templateDelta: PuckAction[],
  _fromTemplateVersion: number,
  _toVersion: number,
  propConflictOptions?: {
    propPatches: PropPatch[];
    fromTemplateContent: { type?: string; props?: Record<string, unknown> }[];
    documentSnapshot: Record<string, unknown>;
  },
): Promise<ConflictResult | null> {
  // Find the document's own version_number at which the last migration was applied.
  // This is distinct from the template version — document version_number tracks
  // the document's edit counter, not which template version it's bound to.
  const lastMigResult = await query<{ version_number: number }>(
    `SELECT COALESCE(MAX(version_number), 0) as version_number
     FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2 AND source = 'migration'`,
    [documentId, branchId],
  );
  const sinceDocVersion = lastMigResult.rows[0]?.version_number ?? 0;

  const result = await query<{ action_metadata: { puckActions?: PuckAction[] } | null }>(
    `SELECT action_metadata
     FROM app.document_versions
     WHERE document_id = $1
       AND branch_id = $2
       AND version_number > $3
       AND action_type = 'structural'
     ORDER BY version_number ASC`,
    [documentId, branchId, sinceDocVersion],
  );

  const documentActions: PuckAction[] = result.rows.flatMap(
    (r) => r.action_metadata?.puckActions ?? [],
  );

  // Detect prop conflicts
  const propConflicts: PropConflict[] = [];
  if (propConflictOptions) {
    const fromContentMap = new Map<string, Record<string, unknown>>();
    for (const c of propConflictOptions.fromTemplateContent) {
      const id = c.props?.id;
      if (typeof id === 'string') {
        fromContentMap.set(id, { ...c.props });
      }
    }

    const docContentMap = buildIdMap(
      Array.isArray(propConflictOptions.documentSnapshot.content)
        ? propConflictOptions.documentSnapshot.content as unknown[]
        : [],
    );

    for (const patch of propConflictOptions.propPatches) {
      const fromProps = fromContentMap.get(patch.componentId);
      const docProps = docContentMap.get(patch.componentId);
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

  if (documentActions.length === 0 && propConflicts.length === 0) {
    return null;
  }

  const templateTypes = new Set(
    templateDelta.flatMap((a) => extractComponentTypes(a)),
  );

  const hasStructuralConflict = documentActions.length > 0 && (
    templateTypes.size === 0
      ? true
      : documentActions.some((a) =>
        extractComponentTypes(a).some((t) => templateTypes.has(t)),
      )
  );

  return {
    hasConflict: hasStructuralConflict,
    templateDelta,
    documentActions,
    propConflicts: propConflicts.length > 0 ? propConflicts : undefined,
  };
}

export async function applyDeltaToDocument(
  documentId: string,
  branchId: string,
  delta: PuckAction[],
  principal: MigrationPrincipal,
  templateContent?: unknown[],
  propMigration?: PropMigrationOptions,
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
  if (!snapshot) {
    throw new Error(`No snapshot found for document ${documentId} on branch ${branchId}`);
  }

  const newSnapshot = applyDeltaToSnapshot(snapshot, delta, templateContent, propMigration);

  const migrationActions = delta.length > 0
    ? delta.map(d => ({ type: 'migration' as const, ...d }))
    : [{ type: 'migration' as const, propPatchCount: propMigration?.propPatches.length ?? 0 }];

  const version = await createDocumentVersion({
    documentId,
    branchId,
    snapshot: newSnapshot,
    source: 'migration',
    createdById: principal.id,
    createdByType: principal.type,
    puckActions: migrationActions,
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

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM app.documents d
     ${TEMPLATE_RELATION_INNER_JOIN}
     WHERE dr.target_document_id = $1
       AND (dr.synced_version IS NULL OR dr.synced_version < $2)
       AND d.archived_at IS NULL`,
    [templateId, toVersion],
  );
  const totalDocuments = parseInt(countResult.rows[0].count, 10);

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

  return mapRowToJob(jobResult.rows[0]);
}

export async function processMigration(
  jobId: string,
  onDocumentsMigrated?: (siteId: string, branchId: string, documentIds: string[]) => Promise<void>,
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
    job.templateId, job.branchId, job.fromVersion, job.toVersion,
  );
  const templateDelta = migrationDelta.structuralActions;

  // Fetch template snapshot at toVersion so insert actions can pull full component data
  const templateSnapshot = await reconstructVersionSnapshot(
    job.templateId, job.branchId, job.toVersion,
  );
  const templateContent = Array.isArray(templateSnapshot?.content)
    ? templateSnapshot.content as unknown[]
    : undefined;

  // Build prop migration options when prop patches exist
  let propMigration: PropMigrationOptions | undefined;
  if (migrationDelta.propPatches.length > 0) {
    const fromTemplateSnapshot = await reconstructVersionSnapshot(
      job.templateId, job.branchId, job.fromVersion,
    );
    const fromContent = Array.isArray(fromTemplateSnapshot?.content)
      ? fromTemplateSnapshot.content as { type?: string; props?: Record<string, unknown> }[]
      : [];
    const fromRootProps = (fromTemplateSnapshot?.root as { props?: Record<string, unknown> } | undefined)?.props;
    type ZoneComponents = { type?: string; props?: Record<string, unknown> }[];
    const fromZones = fromTemplateSnapshot?.zones as
      Record<string, ZoneComponents> | undefined;

    propMigration = {
      propPatches: migrationDelta.propPatches,
      fromTemplateContent: fromContent,
      fromRootProps,
      fromZones,
    };
  }

  let processedDocuments = 0;
  let conflictedDocuments = 0;
  let offset = 0;
  const batchSize = 50;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const docs = await findAffectedDocuments(
      job.siteId, job.branchId, job.templateId, job.toVersion, batchSize, offset,
    );

    if (docs.length === 0) break;

    const cleanDocumentIds: string[] = [];

    for (const doc of docs) {
      const conflict = await detectDocumentConflicts(
        doc.id, job.branchId, templateDelta, doc.templateVersion ?? 0, job.toVersion,
        propMigration ? {
          propPatches: propMigration.propPatches,
          fromTemplateContent: propMigration.fromTemplateContent,
          documentSnapshot: doc.snapshot,
        } : undefined,
      );

      const hasConflict = conflict?.hasConflict ?? false;
      if (hasConflict) {
        await query(
          `INSERT INTO app.migration_conflicts (
             migration_job_id, document_id, branch_id, template_id,
             from_version, to_version, template_delta, document_actions
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [jobId, doc.id, job.branchId, job.templateId,
            job.fromVersion, job.toVersion,
            templateDelta, conflict.documentActions],
        );
        conflictedDocuments++;
      } else {
        try {
          await applyDeltaToDocument(
            doc.id, job.branchId, templateDelta,
            { id: job.createdById, type: job.createdByType },
            templateContent,
            propMigration,
          );
          cleanDocumentIds.push(doc.id);
        } catch (applyErr: unknown) {
          console.error(`Migration: failed to apply delta to document ${doc.id}:`, applyErr);
          await query(
            `INSERT INTO app.migration_conflicts (
               migration_job_id, document_id, branch_id, template_id,
               from_version, to_version, template_delta, document_actions
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [jobId, doc.id, job.branchId, job.templateId,
              job.fromVersion, job.toVersion,
              templateDelta, { error: String(applyErr) }],
          );
          conflictedDocuments++;
        }
      }

      processedDocuments++;
    }

    // Advance the template edge's synced_version for all clean documents in this batch
    if (cleanDocumentIds.length > 0) {
      await query(
        `UPDATE app.document_relations SET synced_version = $1
         WHERE source_document_id = ANY($2) AND relation_type = 'template'`,
        [job.toVersion, cleanDocumentIds],
      );

      // Notify DOs to reload from Postgres so they pick up the migrated snapshots
      if (onDocumentsMigrated) {
        try {
          await onDocumentsMigrated(job.siteId, job.branchId, cleanDocumentIds);
        } catch (notifyErr: unknown) {
          console.error('Migration: failed to notify DOs:', notifyErr);
        }
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

  let rolledBackDocuments = 0;

  if (job.checkpointId !== null && job.checkpointId !== '') {
    const result = await revertToCheckpoint({
      checkpointId: job.checkpointId,
      createdById: principal.id,
      createdByType: principal.type,
    });
    rolledBackDocuments = result.documentsReverted;
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

  await query(
    `UPDATE app.document_relations dr SET synced_version = $1
     FROM app.documents d
     WHERE dr.source_document_id = d.id
       AND dr.target_document_id = $2 AND dr.synced_version = $3
       AND dr.relation_type = 'template' AND d.archived_at IS NULL`,
    [job.fromVersion, job.templateId, job.toVersion],
  );

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

  const migrationDelta = await extractTemplateDelta(templateId, branchId, fromVersion, toVersion);
  const templateDelta = migrationDelta.structuralActions;

  const previewDocuments: MigrationPreviewDocument[] = [];
  let affectedDocuments = 0;
  let estimatedConflicts = 0;
  let offset = 0;
  const batchSize = 50;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const docs = await findAffectedDocuments(
      siteId, branchId, templateId, toVersion, batchSize, offset,
    );

    if (docs.length === 0) break;

    for (const doc of docs) {
      affectedDocuments++;

      const conflict = await detectDocumentConflicts(
        doc.id, branchId, templateDelta, doc.templateVersion ?? 0, toVersion,
      );

      const hasConflict = conflict?.hasConflict ?? false;

      if (hasConflict) {
        estimatedConflicts++;
      }

      if (detail) {
        const previewDoc: MigrationPreviewDocument = {
          documentId: doc.id,
          path: doc.path,
          currentTemplateVersion: doc.templateVersion,
          hasConflict,
        };

        if (hasConflict && conflict) {
          previewDoc.conflictDetails = {
            templateDelta: conflict.templateDelta,
            documentActions: conflict.documentActions,
          };
        } else {
          previewDoc.proposedSnapshot = applyDeltaToSnapshot(doc.snapshot, templateDelta);
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
): Promise<MigrationStatus> {
  // Get the latest version number of the template document
  const versionResult = await query<{ version_number: number }>(
    `SELECT version_number FROM app.document_versions
     WHERE document_id = $1 AND branch_id = $2
     ORDER BY version_number DESC LIMIT 1`,
    [templateId, branchId],
  );

  if (versionResult.rows.length === 0) {
    throw new TemplateNotFoundError(templateId);
  }

  const currentVersion = versionResult.rows[0].version_number;

  // Count stale documents and find the oldest version
  const staleResult = await query<{ count: string; oldest_version: number | null }>(
    `SELECT COUNT(*) as count, MIN(COALESCE(dr.synced_version, 0)) as oldest_version
     FROM app.documents d
     ${TEMPLATE_RELATION_INNER_JOIN}
     WHERE dr.target_document_id = $1
       AND (dr.synced_version IS NULL OR dr.synced_version < $2)
       AND d.archived_at IS NULL`,
    [templateId, currentVersion],
  );

  const staleDocumentCount = parseInt(staleResult.rows[0].count, 10);
  const oldestDocumentVersion = staleResult.rows[0].oldest_version;

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
  const unresolvedConflicts = parseInt(conflictResult.rows[0].count, 10);

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

export async function resolveMigrationConflict(
  conflictId: string,
  resolution: 'apply' | 'skip' | 'manual',
  principal: MigrationPrincipal,
  expectedJobId?: string,
): Promise<MigrationConflict> {
  const conflictResult = await query<MigrationConflictRow>(
    'SELECT * FROM app.migration_conflicts WHERE id = $1',
    [conflictId],
  );

  if (conflictResult.rows.length === 0) {
    throw new Error(`Migration conflict with ID "${conflictId}" not found.`);
  }

  const conflict = conflictResult.rows[0];

  if (expectedJobId !== undefined && conflict.migration_job_id !== expectedJobId) {
    throw new MigrationJobNotFoundError(expectedJobId);
  }

  if (resolution === 'apply') {
    // Tolerate a delta stored as a JSON string, not just a jsonb array.
    const rawDelta = typeof conflict.template_delta === 'string'
      ? (JSON.parse(conflict.template_delta) as unknown)
      : conflict.template_delta;
    const delta = Array.isArray(rawDelta)
      ? rawDelta as PuckAction[]
      : [];

    const tplSnapshot = await reconstructVersionSnapshot(
      conflict.template_id, conflict.branch_id, conflict.to_version,
    );
    const tplContent = Array.isArray(tplSnapshot?.content)
      ? tplSnapshot.content as unknown[]
      : undefined;

    await applyDeltaToDocument(
      conflict.document_id,
      conflict.branch_id,
      delta,
      principal,
      tplContent,
    );

    await query(
      `UPDATE app.document_relations SET synced_version = $1
       WHERE source_document_id = $2 AND relation_type = 'template'`,
      [conflict.to_version, conflict.document_id],
    );
  }

  const updateResult = await query<MigrationConflictRow>(
    `UPDATE app.migration_conflicts
     SET resolution = $1, resolved_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [resolution, conflictId],
  );

  return mapRowToConflict(updateResult.rows[0]);
}
