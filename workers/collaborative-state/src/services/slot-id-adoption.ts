/**
 * One-time slot-id adoption for documents created before durable slot ids.
 *
 * `adoptSlotIds` matches a document's components to its template's slots by
 * type and relative order among occurrences of that type, rewrites matched
 * components' `props.id` to the slot id, and re-keys a rewritten parent's
 * zones. A document that cannot cover the template's pinned slots, or whose
 * rewrites would duplicate an id, is skipped rather than guessed at.
 * `runSlotIdAdoption` drives the pass over every template-bound document and
 * persists each set of rewrites as a migration-sourced version.
 *
 * @see PROPOSAL-015 Design 7
 */

import type { DocumentComponent } from './component-identity';
import { walkComponents, extractComponentIds } from './component-identity';
import { query } from '../db';
import type { PuckAction } from './action-classification';
import {
  getLatestDocumentVersion,
  getLatestDocumentVersionWithFallback,
  createDocumentVersion,
  reconstructVersionSnapshot,
  VersionReconstructionError,
} from './document-version-service';

/**
 * System principal recorded on versions the adoption pass writes.
 */
const SYSTEM_ACTOR = {
  createdById: '00000000-0000-0000-0000-000000000000',
  createdByType: 'system',
} as const;

/**
 * A single `props.id` rewrite from a legacy id to its template slot id.
 */
interface SlotRewrite {
  previousId: string;
  slotId: string;
  type: string;
}

/**
 * Outcome of matching one document snapshot against its template. `snapshot`
 * carries the rewritten document only when `status` is `'adopted'`.
 */
export interface SlotAdoptionOutcome {
  status: 'adopted' | 'already-adopted' | 'skipped';
  reason?: 'template-not-content-shaped' | 'missing-pinned-slot' | 'id-collision';
  snapshot?: Record<string, unknown>;
  rewrites: SlotRewrite[];
}

/**
 * Components of a single `content[]` or `zones[*][]` array, as mutable
 * references into that array.
 */
function componentsOf(array: unknown): DocumentComponent[] {
  return walkComponents({ content: array }).map((ref) => ref.component);
}

/**
 * A snapshot's `zones` map, or an empty map when it is absent or malformed.
 */
function zonesOf(snapshot: Record<string, unknown>): Record<string, unknown> {
  const zones = snapshot.zones;
  if (typeof zones !== 'object' || zones === null || Array.isArray(zones)) {
    return {};
  }
  return zones as Record<string, unknown>;
}

/**
 * Slot ids the template pins: keys of `root.props._pinMap` set to `true`.
 */
function pinnedSlotIds(template: Record<string, unknown>): Set<string> {
  const pinned = new Set<string>();
  const root = template.root;
  if (typeof root !== 'object' || root === null) return pinned;
  const props = (root as { props?: unknown }).props;
  if (typeof props !== 'object' || props === null) return pinned;
  const pinMap = (props as { _pinMap?: unknown })._pinMap;
  if (typeof pinMap !== 'object' || pinMap === null) return pinned;
  for (const [slotId, value] of Object.entries(pinMap as Record<string, unknown>)) {
    if (value === true) pinned.add(slotId);
  }
  return pinned;
}

/**
 * Pairs the i-th document component of a type with the i-th template slot of
 * that type. Excess document components and excess template slots are left
 * unpaired.
 */
function matchByTypeOrder(
  docComponents: DocumentComponent[],
  templateComponents: DocumentComponent[],
): { component: DocumentComponent; slotId: string }[] {
  const slotQueues = new Map<string, string[]>();
  for (const template of templateComponents) {
    const slotId = template.props.id;
    if (typeof slotId !== 'string') continue;
    const queue = slotQueues.get(template.type) ?? [];
    queue.push(slotId);
    slotQueues.set(template.type, queue);
  }

  const consumed = new Map<string, number>();
  const pairs: { component: DocumentComponent; slotId: string }[] = [];
  for (const component of docComponents) {
    if (typeof component.props.id !== 'string') continue;
    const queue = slotQueues.get(component.type);
    if (queue === undefined) continue;
    const index = consumed.get(component.type) ?? 0;
    const slotId = queue[index];
    if (index >= queue.length || slotId === undefined) continue;
    consumed.set(component.type, index + 1);
    pairs.push({ component, slotId });
  }
  return pairs;
}

/**
 * Matches one document snapshot against its template and returns the rewrites
 * needed to adopt the template's slot ids. The inputs are never mutated.
 */
export function adoptSlotIds(
  documentSnapshot: Record<string, unknown>,
  templateSnapshot: unknown,
): SlotAdoptionOutcome {
  if (
    typeof templateSnapshot !== 'object' ||
    templateSnapshot === null ||
    !Array.isArray((templateSnapshot as { content?: unknown }).content)
  ) {
    return { status: 'skipped', reason: 'template-not-content-shaped', rewrites: [] };
  }
  const template = templateSnapshot as Record<string, unknown>;
  const clone = structuredClone(documentSnapshot);

  const assignments: { component: DocumentComponent; slotId: string }[] = [];
  const matchedSlotIds = new Set<string>();
  const parentSlotMap = new Map<string, string>();

  const recordPairs = (pairs: { component: DocumentComponent; slotId: string }[]): void => {
    for (const pair of pairs) {
      assignments.push(pair);
      matchedSlotIds.add(pair.slotId);
      parentSlotMap.set(pair.component.props.id as string, pair.slotId);
    }
  };

  recordPairs(matchByTypeOrder(componentsOf(clone.content), componentsOf(template.content)));

  const docZones = zonesOf(clone);
  const templateZones = zonesOf(template);
  const keyRemap = new Map<string, string>();
  const resolved = new Set<string>();

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [zoneKey, zoneValue] of Object.entries(docZones)) {
      if (resolved.has(zoneKey)) continue;
      const separator = zoneKey.indexOf(':');
      if (separator === -1) {
        resolved.add(zoneKey);
        continue;
      }
      const parentId = zoneKey.slice(0, separator);
      const zoneName = zoneKey.slice(separator + 1);
      const slotParentId = parentSlotMap.get(parentId);
      if (slotParentId === undefined) continue;

      resolved.add(zoneKey);
      progressed = true;
      const newKey = `${slotParentId}:${zoneName}`;
      keyRemap.set(zoneKey, newKey);
      recordPairs(matchByTypeOrder(componentsOf(zoneValue), componentsOf(templateZones[newKey])));
    }
  }

  for (const slotId of pinnedSlotIds(template)) {
    if (!matchedSlotIds.has(slotId)) {
      return { status: 'skipped', reason: 'missing-pinned-slot', rewrites: [] };
    }
  }

  const rewrites: SlotRewrite[] = [];
  for (const { component, slotId } of assignments) {
    const previousId = component.props.id as string;
    if (previousId !== slotId) {
      rewrites.push({ previousId, slotId, type: component.type });
    }
  }

  if (rewrites.length === 0) {
    return { status: 'already-adopted', rewrites: [] };
  }

  for (const { component, slotId } of assignments) {
    component.props.id = slotId;
  }

  let zonesRekeyed = false;
  for (const [oldKey, newKey] of keyRemap) {
    if (oldKey !== newKey) {
      zonesRekeyed = true;
      break;
    }
  }
  if (zonesRekeyed) {
    const rekeyed: Record<string, unknown> = {};
    for (const [zoneKey, zoneValue] of Object.entries(docZones)) {
      rekeyed[keyRemap.get(zoneKey) ?? zoneKey] = zoneValue;
    }
    clone.zones = rekeyed;
  }

  const finalIds = extractComponentIds(clone);
  if (new Set(finalIds).size !== finalIds.length) {
    return { status: 'skipped', reason: 'id-collision', rewrites: [] };
  }

  return { status: 'adopted', snapshot: clone, rewrites };
}

/**
 * Summary of one adoption run over the template-bound documents.
 */
export interface SlotAdoptionRunSummary {
  examined: number;
  adopted: { documentId: string; branchId: string; path: string; rewrites: number }[];
  alreadyAdopted: number;
  skipped: { documentId: string; branchId: string; path: string; reason: string }[];
}

/**
 * A template edge with the source document's path and its site's main branch,
 * the branch that resolves an inherited template version.
 */
interface TemplateEdgeRow {
  document_id: string;
  template_id: string;
  path: string;
  main_branch_id: string;
}

/**
 * Runs the adoption pass over every non-archived document with a template
 * edge, on each branch the document has a version. A dry run only reports what
 * would change; otherwise each adopted document gains a migration-sourced
 * version. Runs inside an active `runWithConnection` scope.
 */
export async function runSlotIdAdoption(
  options: { dryRun: boolean; siteId?: string },
): Promise<SlotAdoptionRunSummary> {
  const summary: SlotAdoptionRunSummary = {
    examined: 0,
    adopted: [],
    alreadyAdopted: 0,
    skipped: [],
  };

  const edges = await query<TemplateEdgeRow>(
    `SELECT dr.source_document_id AS document_id,
       dr.target_document_id AS template_id,
       d.path AS path,
       mb.id AS main_branch_id
     FROM app.document_relations dr
     JOIN app.documents d ON d.id = dr.source_document_id
     JOIN app.branches mb ON mb.site_id = d.site_id AND mb.is_main = true
     WHERE dr.relation_type = 'template'
       AND d.archived_at IS NULL
       ${options.siteId !== undefined ? 'AND d.site_id = $1' : ''}
     ORDER BY d.id`,
    options.siteId !== undefined ? [options.siteId] : [],
  );

  for (const edge of edges.rows) {
    const branches = await query<{ branch_id: string }>(
      'SELECT DISTINCT branch_id FROM app.document_versions WHERE document_id = $1',
      [edge.document_id],
    );

    for (const { branch_id: branchId } of branches.rows) {
      summary.examined += 1;

      const documentVersion = await getLatestDocumentVersion(edge.document_id, branchId);
      // A live version can carry a null snapshot when it stores only CRDT diffs;
      // reconstruct it from the nearest baseline before giving up.
      let documentSnapshot = documentVersion?.snapshot ?? null;
      if (!documentSnapshot && documentVersion && documentVersion.isTombstone !== true) {
        // The pass runs over every document on the site; one whose content
        // cannot be rebuilt joins the skipped list like any other.
        try {
          documentSnapshot = await reconstructVersionSnapshot(
            edge.document_id, branchId, documentVersion.versionNumber,
          );
        } catch (error) {
          if (!(error instanceof VersionReconstructionError)) throw error;
          documentSnapshot = null;
        }
      }
      if (!documentSnapshot || documentVersion?.isTombstone === true) {
        summary.skipped.push({
          documentId: edge.document_id,
          branchId,
          path: edge.path,
          reason: 'document has no live snapshot on this branch',
        });
        continue;
      }

      const templateVersion = await getLatestDocumentVersionWithFallback(
        edge.template_id,
        branchId,
        edge.main_branch_id,
      );
      if (!templateVersion?.version.snapshot || templateVersion.version.isTombstone === true) {
        summary.skipped.push({
          documentId: edge.document_id,
          branchId,
          path: edge.path,
          reason: 'template has no live snapshot on this branch',
        });
        continue;
      }

      const outcome = adoptSlotIds(documentSnapshot, templateVersion.version.snapshot);

      if (outcome.status === 'already-adopted') {
        summary.alreadyAdopted += 1;
        continue;
      }
      if (outcome.status === 'skipped') {
        summary.skipped.push({
          documentId: edge.document_id,
          branchId,
          path: edge.path,
          reason: outcome.reason ?? 'skipped',
        });
        continue;
      }

      if (!options.dryRun && outcome.snapshot) {
        // The rewrite was computed from the snapshot read above. If a newer
        // version has landed since — a concurrent editing session — writing it
        // would clobber that edit, so skip the document rather than overwrite.
        const currentVersion = await getLatestDocumentVersion(edge.document_id, branchId);
        if (currentVersion?.id !== documentVersion?.id) {
          summary.skipped.push({
            documentId: edge.document_id,
            branchId,
            path: edge.path,
            reason: 'document changed during adoption',
          });
          continue;
        }

        const puckActions: PuckAction[] = [
          { type: 'migration', adoption: true, rewrites: outcome.rewrites.length },
        ];
        await createDocumentVersion({
          documentId: edge.document_id,
          branchId,
          snapshot: outcome.snapshot,
          source: 'migration',
          createdById: SYSTEM_ACTOR.createdById,
          createdByType: SYSTEM_ACTOR.createdByType,
          puckActions,
        });
      }
      summary.adopted.push({
        documentId: edge.document_id,
        branchId,
        path: edge.path,
        rewrites: outcome.rewrites.length,
      });
    }
  }

  return summary;
}
