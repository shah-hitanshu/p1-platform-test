/**
 * Localization Authority Service
 *
 * A translation's effective authority lives across the database: the per-prop
 * overrides on its localization edge, and the per-slot defaults declared by the
 * template bound to its canonical. This service resolves those, serves them to a
 * client that needs to tell an owned prop from an inherited one, and evaluates a
 * set of writes against them by delegating to the pure validator.
 *
 * @see packages/p1-content-validator/src/authority-enforcement.ts
 */

import {
  validateTranslationAuthority,
  resolveSlotAuthorityMap,
  DEFAULT_AUTHORITY,
} from '@pantheon-systems/p1-content-validator';
import type {
  Authority,
  AuthorityDiagnostic,
  AuthoritySeverity,
  EditOperation,
} from '@pantheon-systems/p1-content-validator';

import { getDocument } from './document-service';
import { getLatestTemplateVersionWithFallback } from './document-version-service';
import { findMainBranchId, getLatestSnapshot } from './template-read';
import {
  getAuthorityOverrides,
  authorityOverridesToJson,
  getLocalizationEdgeBySource,
} from './relations-service';

/**
 * Parameters for evaluating authority on a set of writes to a translation.
 */
export interface EvaluateTranslationAuthorityParams {
  translationDocumentId: string;
  branchId: string;
  operations: EditOperation[];
  /** Severity to stamp on diagnostics. Defaults to `warning`. */
  severity?: AuthoritySeverity;
}

/**
 * Resolves the template snapshot a translation's authority defaults and pins
 * derive from: the template bound to its canonical, read from whichever branch
 * holds it. Returns undefined when the canonical has no template, in which case
 * every slot defaults to `canonical` authority and nothing is pinned.
 *
 * `mainBranchId` is looked up when omitted: a template inherited from main is
 * invisible on the inheriting branch, and an undefined snapshot is indistinguishable
 * from a template that declares no authority or pins.
 */
export async function resolveCanonicalTemplateSnapshot(
  canonicalDocumentId: string,
  branchId: string,
  mainBranchId?: string,
): Promise<Record<string, unknown> | undefined> {
  const canonical = await getDocument(canonicalDocumentId);
  if (canonical?.templateId === undefined) {
    return undefined;
  }
  const templateId = canonical.templateId;

  // A branch that has not edited the template holds no version of it and reads
  // main's copy; a template deleted on the branch resolves to nothing rather than
  // resurrecting main's.
  const mainId = mainBranchId ?? (await findMainBranchId(branchId)) ?? branchId;
  const fallback = await getLatestTemplateVersionWithFallback(templateId, branchId, mainId);
  if (fallback === null) {
    return undefined;
  }

  const template = await getLatestSnapshot(templateId, fallback.inherited ? mainId : branchId);
  return template ?? undefined;
}

/**
 * The per-slot authority a translation's props fall back to when no per-prop
 * override names them: `slotDefaults` for the slots the canonical's template
 * declares, `defaultAuthority` for every slot it does not. A client resolves a
 * prop by reading its override, then its slot default, then `defaultAuthority`.
 */
export interface SlotAuthorityDefaults {
  slotDefaults: Record<string, Authority>;
  defaultAuthority: Authority;
}

/**
 * Resolves the per-slot authority defaults for a translation of the given
 * canonical. A canonical with no template declares no slots, leaving every prop on
 * `defaultAuthority`.
 */
export async function resolveSlotAuthorityDefaults(
  canonicalDocumentId: string,
  branchId: string,
): Promise<SlotAuthorityDefaults> {
  const templateSnapshot = await resolveCanonicalTemplateSnapshot(canonicalDocumentId, branchId);
  return {
    slotDefaults: resolveSlotAuthorityMap(templateSnapshot),
    defaultAuthority: DEFAULT_AUTHORITY,
  };
}

/**
 * Evaluates a set of writes against a translation and returns a diagnostic for
 * each write to a canonical-authority prop. A document with no localization edge
 * is not a translation and yields no diagnostics.
 */
export async function evaluateTranslationAuthority(
  params: EvaluateTranslationAuthorityParams,
): Promise<{ diagnostics: AuthorityDiagnostic[] }> {
  const edge = await getLocalizationEdgeBySource(params.translationDocumentId);
  if (edge === null) {
    return { diagnostics: [] };
  }

  const currentSnapshot = await getLatestSnapshot(params.translationDocumentId, params.branchId);
  if (currentSnapshot === null) {
    return { diagnostics: [] };
  }

  const authorityOverrides = await getAuthorityOverrides(params.translationDocumentId);
  // The same resolved defaults the authority read serves, so a server-side
  // evaluation and a client holding that response resolve a slot identically.
  const { slotDefaults } = await resolveSlotAuthorityDefaults(
    edge.targetDocumentId,
    params.branchId,
  );

  return validateTranslationAuthority({
    operations: params.operations,
    currentSnapshot,
    templateSnapshot: undefined,
    slotAuthority: slotDefaults,
    authorityOverrides: authorityOverridesToJson(authorityOverrides),
    severity: params.severity,
  });
}
