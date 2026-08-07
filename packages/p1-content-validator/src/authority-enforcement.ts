import type {
  Authority,
  AuthorityDiagnostic,
  ValidateTranslationAuthorityInput,
} from './types.js';
import { isAuthority, resolveSlotAuthority } from './localization.js';
import { isPlainObject, resolvePropPath } from './guards.js';

/**
 * Authority enforcement for writes against a translation document.
 *
 * A translation owns its `locale`-authority props and inherits its
 * `canonical`-authority props from the canonical it derives from. Writing a
 * `canonical`-authority prop outside the sync/reconcile workflow is reported as a
 * diagnostic at the caller's severity, never rejected here.
 *
 * This module is pure: the caller resolves the template snapshot and the
 * localization edge's per-prop overrides and passes them in.
 */

/**
 * Resolves the component a prop-path op targets and returns its slot id, or
 * `undefined` when the path does not target a prop on a resolvable component.
 * Authority is keyed by slot id, so a component without one is not judged.
 */
function resolveSlot(
  path: string,
  snapshot: Record<string, unknown>,
): { slotId: string; propsIdx: number; parts: string[] } | undefined {
  const resolved = resolvePropPath(path, snapshot);
  if (resolved === undefined || typeof resolved.component.props.id !== 'string') {
    return undefined;
  }
  return { slotId: resolved.component.props.id, propsIdx: resolved.propsIdx, parts: resolved.parts };
}

export function validateTranslationAuthority(
  input: ValidateTranslationAuthorityInput,
): { diagnostics: AuthorityDiagnostic[] } {
  const {
    operations,
    currentSnapshot,
    templateSnapshot,
    authorityOverrides = {},
    slotAuthority = {},
    severity = 'warning',
  } = input;
  const diagnostics: AuthorityDiagnostic[] = [];

  // Slot ids and prop names are caller-chosen keys arriving as parsed JSON, so both
  // maps are read through a Map: a missing key stays missing instead of resolving to
  // an Object.prototype member. A stored value that is not an authority is dropped,
  // leaving its prop on `canonical`.
  const overrides = new Map(
    Object.entries(authorityOverrides).map(([slotId, props]) => [
      slotId,
      new Map(Object.entries(props).filter(([, value]) => isAuthority(value))),
    ]),
  );
  const slotDefaults = new Map(
    Object.entries(slotAuthority).filter((entry): entry is [string, Authority] =>
      isAuthority(entry[1]),
    ),
  );

  const effectiveAuthority = (slotId: string, propName: string): Authority =>
    overrides.get(slotId)?.get(propName) ??
    slotDefaults.get(slotId) ??
    resolveSlotAuthority(templateSnapshot, slotId);

  const flag = (opIndex: number, path: string, slotId: string, propName: string): void => {
    diagnostics.push({
      opIndex,
      path,
      code: 'canonical_authority_write',
      severity,
      slotId,
      propName,
      authority: 'canonical',
      message:
        `Write to canonical-authority prop "${propName}" on slot "${slotId}" of a translation. ` +
        `This prop is owned by the canonical; edit it there and let sync propagate the value.`,
    });
  };

  operations.forEach((op, opIndex) => {
    if (op.type !== 'add' && op.type !== 'replace') return;
    if (op.content === undefined) return;

    const resolved = resolveSlot(op.path, currentSnapshot);
    if (resolved === undefined) return;
    const { slotId, propsIdx, parts } = resolved;

    // Case A: the path ends at `.props` — the content is the whole props object.
    if (propsIdx === parts.length - 1) {
      if (!isPlainObject(op.content)) return;
      for (const propName of Object.keys(op.content)) {
        if (propName === 'id') continue;
        if (effectiveAuthority(slotId, propName) === 'canonical') {
          flag(opIndex, `${op.path}.${propName}`, slotId, propName);
        }
      }
      return;
    }

    // Case B: the path targets a single prop — `.props.<name>`.
    const propName = parts[propsIdx + 1];
    if (propName === 'id') return;
    if (effectiveAuthority(slotId, propName) === 'canonical') {
      flag(opIndex, op.path, slotId, propName);
    }
  });

  return { diagnostics };
}
