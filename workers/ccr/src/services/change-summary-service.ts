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
 * The two relation types name their starting point differently. A template edge
 * pins a version number, read against whichever branch holds the template. A
 * localization edge pins a version's identity, so it resolves the same on every
 * branch — a number would name a different version, or none, off the branch that
 * recorded it.
 *
 * @see workers/src/services/migration-service.ts (shared diff core)
 * @see packages/p1-content-validator/src/localization.ts (resolvers)
 */

import {
  resolveTranslatable,
  resolveSlotAuthority,
  ROOT_SLOT_ID,
  type Authority,
} from '@pantheon-systems/p1-content-validator';
import type { DocumentVersion } from '../types/domain';
import { walkComponents } from './component-identity';
import { getDocument } from './document-service';
import {
  getDocumentVersion,
  getLatestDocumentVersion,
  getLatestDocumentVersionWithFallback,
  reconstructVersionSnapshot,
} from './document-version-service';
import type { DocumentWithArchive } from './document-types';
import { findMainBranchId, getLatestSnapshot, resolveTemplateReadBranch } from './template-read';
import { buildUpstreamDelta, extractUpstreamDelta } from './migration-service';
import { fingerprintValue } from '../utils/value-fingerprint';
import {
  getEdgeByDerivedDocument,
  getLocalizationEdgeByDerivedDocument,
  authorityOverridesFromMetadata,
  getUpstreamResolutions,
} from './relations-service';
import type { AuthorityOverrides, UpstreamResolutions } from './relations-service';
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
  /**
   * When this prop was reconciled. Set only while that resolution still covers the
   * change; a prop the canonical has moved since reads as outstanding again.
   * Localization prop entries only.
   */
  resolvedAt?: string;
}

/**
 * The classified drift of a derived document against its upstream edge.
 * `slotDelta` is the raw id-keyed structural delta (superset-compatible with the
 * dashboard's `CssMigrationPreview.templateDelta`); `changes` is the per-change
 * classified view, holding the resolved changes only when they were asked for;
 * `counts` tallies each bucket over `changes`. `resolvedCount` counts the changes
 * a resolution covers whether or not they are listed.
 */
export interface ChangeSummary {
  relationType: ChangeRelationType;
  derivedDocumentId: string;
  upstreamDocumentId: string;
  /**
   * The number of the version the comparison starts from, on the branch that
   * holds that version. For a localization edge the pinned version may live on
   * another branch, so this and `toVersion` can be numbered against different
   * histories; `fromVersionId` is the handle that compares across branches.
   */
  fromVersion: number;
  toVersion: number;
  /** Identity of the version the comparison starts from; null on a template edge. */
  fromVersionId: string | null;
  /** Identity of the version the comparison runs to, the upstream's current one. */
  toVersionId: string;
  slotDelta: SlotDelta;
  changes: ChangeSummaryEntry[];
  counts: Record<ChangeClassification, number>;
  resolvedCount: number;
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
  /**
   * List the changes a resolution covers alongside the outstanding ones. Off by
   * default, so a caller asking what is left to reconcile gets that.
   */
  includeResolved?: boolean;
}

/** An edge reduced to the fields a change summary needs. */
interface UpstreamEdge {
  upstreamDocumentId: string;
  syncedUpstreamVersion: number | null;
  /** Set on a localization edge, which pins by identity rather than by number. */
  syncedUpstreamVersionId: string | null;
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
      syncedUpstreamVersionId: edge.syncedUpstreamVersionId,
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
    syncedUpstreamVersionId: null,
    metadata: {},
  };
}

/**
 * Indexes a snapshot's props by slot id, first occurrence winning. Root props
 * belong to no component and are keyed by `ROOT_SLOT_ID`, the same slot id the
 * prop diff addresses them with.
 */
export function indexPropsById(
  snapshot: Record<string, unknown> | null,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (snapshot === null) {
    return map;
  }
  const rootProps = (snapshot.root as { props?: Record<string, unknown> } | undefined)?.props;
  if (rootProps !== undefined) {
    map.set(ROOT_SLOT_ID, rootProps);
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
export function readAtPointer(
  props: Record<string, unknown> | undefined,
  pointer: string,
): unknown {
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

/**
 * What a prop's recorded resolution is judged against: the canonical's props as
 * they stand now, which is the value each resolution's fingerprint is compared to.
 */
interface ResolutionContext {
  resolutions: UpstreamResolutions;
  toProps: Map<string, Record<string, unknown>>;
}

/** Context a localization prop change is classified against. */
interface LocalizationContext {
  canonicalSnapshot: Record<string, unknown> | null;
  templateSnapshot: Record<string, unknown> | undefined;
  authorityOverrides: AuthorityOverrides;
  resolution: ResolutionContext;
}

/**
 * When the change at one pointer was reconciled, or undefined while the change is
 * outstanding.
 *
 * A resolution stands while the canonical still holds the value it was settled
 * against. A canonical that has moved that prop since reads as outstanding again,
 * and one that has moved it back reads as settled, since the translation is aligned
 * to that very value.
 */
async function readResolution(
  context: ResolutionContext,
  componentId: string,
  propPath: string,
): Promise<string | undefined> {
  const resolution = context.resolutions.get(componentId)?.get(propPath);
  if (resolution === undefined) {
    return undefined;
  }
  const now = readAtPointer(context.toProps.get(componentId), propPath);
  return (await fingerprintValue(now)) === resolution.hash ? resolution.at : undefined;
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

/** An upstream's current version, and the branch its history is read from. */
interface UpstreamVersion {
  version: DocumentVersion;
  branchId: string;
}

/**
 * A template's current version: the branch's own when it holds one, otherwise
 * main's, which a branch that has not edited the template inherits.
 */
async function resolveTemplateUpstreamVersion(
  templateId: string,
  branchId: string,
  mainBranchId: string | undefined,
): Promise<UpstreamVersion | null> {
  const readBranchId = await resolveTemplateReadBranch(templateId, branchId, mainBranchId);
  const version = await getLatestDocumentVersion(templateId, readBranchId);
  return version === null ? null : { version, branchId: readBranchId };
}

/**
 * A canonical's current version as a branch sees it: the branch's own when it has
 * edited the page, otherwise the version it inherits from main, which is main's
 * latest published rather than its latest draft.
 */
async function resolveCanonicalUpstreamVersion(
  canonicalId: string,
  branchId: string,
  mainBranchId: string | undefined,
): Promise<UpstreamVersion | null> {
  const latest = await getLatestDocumentVersionWithFallback(
    canonicalId,
    branchId,
    mainBranchId ?? branchId,
  );
  if (latest === null) {
    return null;
  }
  return {
    version: latest.version,
    branchId: latest.inherited && mainBranchId !== undefined ? mainBranchId : branchId,
  };
}

/**
 * Where a comparison starts. A null `fromVersionId` means the start is named by
 * a number on the branch being read, which the caller reconstructs; an id names
 * the version itself, and `snapshot` is the content to diff forward from.
 * `pinnedBranchId` is the branch that version lives on, so a caller can tell
 * whether `fromVersion` shares a numbering sequence with the version it reads.
 */
interface ComparisonStart {
  fromVersion: number;
  fromVersionId: string | null;
  pinnedBranchId: string | null;
  snapshot: Record<string, unknown> | null;
}

/**
 * Resolves the version a derived document's comparison measures from.
 *
 * A template edge pins by number, read against whichever branch holds the
 * template. A localization edge pins by identity, so the pinned version is read
 * wherever it lives — the branch that created the translation, which need not be
 * the branch the translation is being read on.
 *
 * A localization edge with nothing pinned, or one whose pinned version has since
 * been removed, measures from the upstream's current version, which yields an
 * empty delta rather than a comparison against a guessed starting point.
 */
async function resolveComparisonStart(
  edge: UpstreamEdge,
  relationType: ChangeRelationType,
  toVersion: number,
): Promise<ComparisonStart> {
  const unpinned = {
    fromVersion: toVersion,
    fromVersionId: null,
    pinnedBranchId: null,
    snapshot: null,
  };

  if (relationType !== 'localization') {
    return { ...unpinned, fromVersion: edge.syncedUpstreamVersion ?? toVersion };
  }

  if (edge.syncedUpstreamVersionId === null) {
    return unpinned;
  }

  const pinned = await getDocumentVersion(edge.syncedUpstreamVersionId);
  if (pinned === null) {
    return unpinned;
  }

  const snapshot = pinned.snapshot ?? await reconstructVersionSnapshot(
    pinned.documentId,
    pinned.branchId,
    pinned.versionNumber,
  );

  return {
    fromVersion: pinned.versionNumber,
    fromVersionId: pinned.id,
    pinnedBranchId: pinned.branchId,
    snapshot,
  };
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

  // The upstream's current state, as the branch being read sees it. A template
  // lives on whichever branch holds it. A canonical is an ordinary page, so a
  // branch that has not edited it sees the version it inherits from main.
  const current = relationType === 'template'
    ? await resolveTemplateUpstreamVersion(edge.upstreamDocumentId, branchId, mainBranchId)
    : await resolveCanonicalUpstreamVersion(edge.upstreamDocumentId, branchId, mainBranchId);

  // A tombstone is the newest version of a document deleted on the branch it is read
  // from. It reads as absent rather than as content to diff, matching how a template
  // deleted on a branch resolves to nothing instead of falling back to main.
  if (current === null || current.version.isTombstone === true) {
    return null;
  }
  const upstreamBranchId = current.branchId;
  const toVersion = current.version.versionNumber;

  const start = await resolveComparisonStart(edge, relationType, toVersion);
  const { fromVersion, fromVersionId } = start;

  // A pin ahead of the version this branch serves, on the same history: the
  // translation was made from a draft that the branch cannot see. Diffing from it
  // would run backwards and report the superseded content as a change to apply.
  if (start.pinnedBranchId === upstreamBranchId && fromVersion > toVersion) {
    return {
      relationType,
      derivedDocumentId,
      upstreamDocumentId: edge.upstreamDocumentId,
      fromVersion,
      toVersion,
      fromVersionId,
      toVersionId: current.version.id,
      slotDelta: { added: [], removed: [], moved: [], templateIds: [] },
      changes: [],
      counts: emptyCounts(),
      resolvedCount: 0,
    };
  }

  const upstream = fromVersionId === null
    ? await extractUpstreamDelta(
      edge.upstreamDocumentId,
      upstreamBranchId,
      fromVersion,
      toVersion,
    )
    : buildUpstreamDelta(
      start.snapshot,
      await reconstructVersionSnapshot(edge.upstreamDocumentId, upstreamBranchId, toVersion),
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
      resolution: {
        resolutions: await getUpstreamResolutions(derivedDocumentId, branchId, mainBranchId),
        toProps: indexPropsById(upstream.toSnapshot),
      },
    };
  }

  const changes: ChangeSummaryEntry[] = [];
  const counts = emptyCounts();
  let resolvedCount = 0;

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
        const propName = topLevelPropName(op.path);
        const { classification, authority, translatable } = classifyLocalizationProp(
          patch.componentId,
          propName,
          localizationContext,
        );
        entry.classification = classification;
        entry.authority = authority;
        entry.translatable = translatable;

        const resolved = await readResolution(
          localizationContext.resolution,
          patch.componentId,
          op.path,
        );
        if (resolved !== undefined) {
          entry.resolvedAt = resolved;
          resolvedCount++;
          if (params.includeResolved !== true) {
            continue;
          }
        }
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
    fromVersionId,
    toVersionId: current.version.id,
    slotDelta: upstream.slotDelta,
    changes,
    counts,
    resolvedCount,
  };
}
