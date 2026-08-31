/**
 * Change Summary Service
 *
 * Given a document that derives from a relation edge, computes how its upstream
 * drifted between the version the derived document is synced to and the
 * upstream's current version, and classifies each change so the dashboard,
 * editor, and MCP can bucket it without re-deriving authority or translatability.
 *
 * The structural and prop diffing is the same engine the template migration uses
 * (`extractUpstreamDelta`), parameterized by relation type:
 *  - `template`: derived = document, upstream = template. Changes stay
 *    `structural` / `prop`; the localization axes do not apply.
 *  - `localization`: derived = translation, upstream = canonical. Each prop
 *    change is classified by the translation's effective authority for the
 *    slot/prop and the canonical's per-prop translatability.
 *
 * @see workers/src/services/migration-service.ts (shared diff core)
 * @see packages/p1-content-validator/src/localization.ts (resolvers)
 */

import {
  resolveTranslatable,
  resolveSlotAuthority,
  type Authority,
} from '@pantheon-systems/p1-content-validator';
import { walkComponents } from './component-identity';
import { getDocument } from './document-service';
import { getLatestDocumentVersion } from './document-version-service';
import type { DocumentWithArchive } from './document-types';
import { findMainBranchId, getLatestSnapshot, resolveTemplateReadBranch } from './template-read';
import { extractUpstreamDelta } from './migration-service';
import {
  getEdgeByDerivedDocument,
  getLocalizationEdgeByDerivedDocument,
  authorityOverridesFromMetadata,
} from './relations-service';
import type { AuthorityOverrides } from './relations-service';
import { resolveCanonicalTemplateSnapshot } from './localization-enforcement-service';
import type { SlotDelta } from './slot-delta';

/**
 * How a single change is bucketed.
 *
 *  - `structural`: a slot was added, removed, or moved upstream.
 *  - `prop`: a template-relation prop change (no localization axes apply).
 *  - `advisory`: a localization prop change on a slot/prop the translation owns
 *    (effective authority `locale`); the translation may keep its own value.
 *  - `needsTranslation`: a localization prop change the canonical owns
 *    (authority `canonical`) on translatable text; a human should translate it.
 *  - `autoApplied`: a localization prop change the canonical owns on a
 *    non-translatable prop; the canonical value applies verbatim.
 */
export type ChangeClassification =
  | 'structural'
  | 'prop'
  | 'advisory'
  | 'needsTranslation'
  | 'autoApplied';

/** The relation types a change summary can diff a document against. */
export const RELATION_TYPES = ['template', 'localization'] as const;
export type ChangeRelationType = (typeof RELATION_TYPES)[number];

/** Whether an untrusted string names a relation type a change summary can diff. */
export function isChangeRelationType(value: string): value is ChangeRelationType {
  return RELATION_TYPES.includes(value as ChangeRelationType);
}

/**
 * One classified change. `upstreamOldValue` / `upstreamNewValue` are the edge's
 * upstream values regardless of relation type; `documentValue` is the derived
 * document's current value at that path.
 */
export interface ChangeSummaryEntry {
  classification: ChangeClassification;
  /** Slot id of the changed component, or `__root__` for a root-prop change. */
  componentId: string;
  /** JSON Pointer into the component props; absent for structural entries. */
  propPath?: string;
  upstreamOldValue?: unknown;
  upstreamNewValue?: unknown;
  documentValue?: unknown;
  /** Effective authority; set on localization prop entries only. */
  authority?: Authority;
  /** Canonical translatability; set on localization prop entries only. */
  translatable?: boolean;
  /** The structural operation; set on structural entries only. */
  structuralKind?: 'added' | 'removed' | 'moved';
}

/**
 * The classified drift of a derived document against its upstream edge.
 * `slotDelta` is the raw id-keyed structural delta (superset-compatible with the
 * dashboard's `CssMigrationPreview.templateDelta`); `changes` is the per-change
 * classified view; `counts` tallies each bucket.
 */
export interface ChangeSummary {
  relationType: ChangeRelationType;
  derivedDocumentId: string;
  upstreamDocumentId: string;
  fromVersion: number;
  toVersion: number;
  slotDelta: SlotDelta;
  changes: ChangeSummaryEntry[];
  counts: Record<ChangeClassification, number>;
}

export interface BuildChangeSummaryParams {
  derivedDocumentId: string;
  branchId: string;
  relationType: ChangeRelationType;
  /**
   * Main branch `branchId` inherits from. Looked up when omitted; supply it to
   * spare the lookup when summarising many documents on one branch.
   */
  mainBranchId?: string;
}

/** An edge reduced to the fields a change summary needs. */
interface UpstreamEdge {
  upstreamDocumentId: string;
  syncedUpstreamVersion: number | null;
  metadata: Record<string, unknown>;
}

async function resolveEdge(
  derivedDocumentId: string,
  relationType: ChangeRelationType,
): Promise<UpstreamEdge | null> {
  if (relationType === 'localization') {
    const edge = await getLocalizationEdgeByDerivedDocument(derivedDocumentId);
    if (edge === null) {
      return null;
    }
    return {
      upstreamDocumentId: edge.upstreamDocumentId,
      syncedUpstreamVersion: edge.syncedUpstreamVersion,
      metadata: edge.metadata,
    };
  }

  const templateEdge = await getEdgeByDerivedDocument(derivedDocumentId, 'template');
  if (templateEdge === null) {
    return null;
  }
  return {
    upstreamDocumentId: templateEdge.upstreamDocumentId,
    syncedUpstreamVersion: templateEdge.syncedUpstreamVersion,
    metadata: {},
  };
}

/** Indexes a snapshot's component props by slot id, first occurrence winning. */
function indexPropsById(
  snapshot: Record<string, unknown> | null,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (snapshot === null) {
    return map;
  }
  for (const ref of walkComponents(snapshot)) {
    const id = ref.component.props.id;
    if (typeof id === 'string' && !map.has(id)) {
      map.set(id, ref.component.props);
    }
  }
  return map;
}

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Reads a value at a JSON Pointer (e.g. `/title`, `/badge/label`) within props. */
function readAtPointer(props: Record<string, unknown> | undefined, pointer: string): unknown {
  if (props === undefined) {
    return undefined;
  }
  const segments = pointer
    .split('/')
    .filter((s) => s.length > 0)
    .map(unescapePointerSegment);
  let current: unknown = props;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      current = Number.isNaN(index) ? undefined : current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** The top-level prop name a JSON Pointer targets, e.g. `/badge/label` -> `badge`. */
function topLevelPropName(pointer: string): string {
  const first = pointer.split('/').find((s) => s.length > 0) ?? '';
  return unescapePointerSegment(first);
}

function emptyCounts(): Record<ChangeClassification, number> {
  return { structural: 0, prop: 0, advisory: 0, needsTranslation: 0, autoApplied: 0 };
}

/** Context a localization prop change is classified against. */
interface LocalizationContext {
  canonicalSnapshot: Record<string, unknown> | null;
  templateSnapshot: Record<string, unknown> | undefined;
  authorityOverrides: AuthorityOverrides;
}

function classifyLocalizationProp(
  componentId: string,
  propName: string,
  context: LocalizationContext,
): { classification: ChangeClassification; authority: Authority; translatable: boolean } {
  const authority: Authority =
    context.authorityOverrides.get(componentId)?.get(propName) ??
    resolveSlotAuthority(context.templateSnapshot, componentId);
  const translatable = resolveTranslatable(context.canonicalSnapshot, componentId, propName);

  let classification: ChangeClassification;
  if (authority === 'locale') {
    classification = 'advisory';
  } else if (translatable) {
    classification = 'needsTranslation';
  } else {
    classification = 'autoApplied';
  }
  return { classification, authority, translatable };
}

/**
 * Builds the classified change summary for a derived document against its
 * upstream edge of the given relation type. Returns null when there is nothing
 * to reconcile against: no edge of that type, an archived upstream, or an
 * upstream with no live version on the branch it is read from.
 */
export async function buildChangeSummary(
  params: BuildChangeSummaryParams,
): Promise<ChangeSummary | null> {
  const { derivedDocumentId, branchId, relationType } = params;

  const edge = await resolveEdge(derivedDocumentId, relationType);
  if (edge === null) {
    return null;
  }

  // An archived upstream is not something to reconcile against, on the same
  // terms template migration refuses to run against one.
  const upstreamDoc: DocumentWithArchive | null = await getDocument(edge.upstreamDocumentId);
  if (upstreamDoc === null || upstreamDoc.archivedAt !== undefined) {
    return null;
  }

  const mainBranchId = params.mainBranchId ?? (await findMainBranchId(branchId));

  // A template upstream lives on whichever branch holds it; a canonical upstream
  // is a page, read on the derived document's own branch.
  const upstreamBranchId =
    relationType === 'template'
      ? await resolveTemplateReadBranch(edge.upstreamDocumentId, branchId, mainBranchId)
      : branchId;

  // A tombstone is the newest version of a document deleted on the branch it is read
  // from. It reads as absent rather than as content to diff, matching how a template
  // deleted on a branch resolves to nothing instead of falling back to main.
  const latestUpstream = await getLatestDocumentVersion(edge.upstreamDocumentId, upstreamBranchId);
  if (latestUpstream === null || latestUpstream.isTombstone === true) {
    return null;
  }
  const toVersion = latestUpstream.versionNumber;
  // A null pin means the derived document is not aligned to a specific upstream
  // version; diffing the upstream against itself yields an empty delta.
  const fromVersion = edge.syncedUpstreamVersion ?? toVersion;

  const upstream = await extractUpstreamDelta(
    edge.upstreamDocumentId,
    upstreamBranchId,
    fromVersion,
    toVersion,
  );

  const fromUpstreamProps = indexPropsById(upstream.fromSnapshot);
  const derivedProps = indexPropsById(await getLatestSnapshot(derivedDocumentId, branchId));

  let localizationContext: LocalizationContext | null = null;
  if (relationType === 'localization') {
    localizationContext = {
      canonicalSnapshot: upstream.toSnapshot,
      templateSnapshot: await resolveCanonicalTemplateSnapshot(
        edge.upstreamDocumentId,
        branchId,
        mainBranchId,
      ),
      authorityOverrides: authorityOverridesFromMetadata(edge.metadata),
    };
  }

  const changes: ChangeSummaryEntry[] = [];
  const counts = emptyCounts();

  const pushStructural = (componentId: string, kind: 'added' | 'removed' | 'moved'): void => {
    changes.push({ classification: 'structural', componentId, structuralKind: kind });
    counts.structural++;
  };

  for (const add of upstream.slotDelta.added) {
    const id = add.component.props.id;
    if (typeof id === 'string') {
      pushStructural(id, 'added');
    }
  }
  for (const id of upstream.slotDelta.removed) {
    pushStructural(id, 'removed');
  }
  for (const move of upstream.slotDelta.moved) {
    pushStructural(move.id, 'moved');
  }

  for (const patch of upstream.propPatches) {
    const fromProps = fromUpstreamProps.get(patch.componentId);
    const docProps = derivedProps.get(patch.componentId);
    for (const op of patch.operations) {
      const entry: ChangeSummaryEntry = {
        classification: 'prop',
        componentId: patch.componentId,
        propPath: op.path,
        upstreamOldValue: readAtPointer(fromProps, op.path),
        upstreamNewValue: 'value' in op ? (op as { value: unknown }).value : undefined,
        documentValue: readAtPointer(docProps, op.path),
      };

      if (localizationContext !== null) {
        const { classification, authority, translatable } = classifyLocalizationProp(
          patch.componentId,
          topLevelPropName(op.path),
          localizationContext,
        );
        entry.classification = classification;
        entry.authority = authority;
        entry.translatable = translatable;
      }

      counts[entry.classification]++;
      changes.push(entry);
    }
  }

  return {
    relationType,
    derivedDocumentId,
    upstreamDocumentId: edge.upstreamDocumentId,
    fromVersion,
    toVersion,
    slotDelta: upstream.slotDelta,
    changes,
    counts,
  };
}
