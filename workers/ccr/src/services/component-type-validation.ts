/**
 * Server-side enforcement of component-type identity on incoming edits.
 *
 * The MCP surfaces already validate ops against the registry, but that check is
 * advisory: it is per-process, skippable, wrapped in error-swallowing catches,
 * and there is more than one implementation of it. This module is the backend's
 * own check, so a mis-cased or unknown component type cannot reach a document
 * regardless of which client wrote it.
 *
 * @see docs/puck/plans/2026-08-05-component-registry-casing-research.md
 */

/** Case-insensitive lookup key → the descriptor's true-cased name. */
export type CanonicalComponentNames = Map<string, string>;

/**
 * Lookups are case-insensitive so a mis-cased type can be *found* — that is what
 * lets the violation below name the casing the writer should have used. It is
 * never a licence to decide what casing gets written; the descriptor's `name`
 * decides that.
 *
 * Keep it case-insensitive even after component paths preserve case: exact
 * matching would stop resolving a mis-cased type at all, turning a precise
 * "use QuoteBlock" into a bare unknown-type error.
 */
export function componentTypeKey(type: string): string {
  return type.toLowerCase();
}

export interface ComponentTypeViolation {
  opIndex: number;
  path: string;
  type: string;
  code: 'unknown_component_type' | 'component_type_case_mismatch';
  message: string;
}

interface OperationLike {
  type?: string;
  path?: string;
  value?: unknown;
  content?: unknown;
}

function isComponentShape(value: unknown): value is { type: string; props: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { type, props } = value as { type?: unknown; props?: unknown };
  return typeof type === 'string' && typeof props === 'object' && props !== null;
}

function collectViolations(
  value: unknown,
  canonical: CanonicalComponentNames,
  opIndex: number,
  path: string,
  violations: ComponentTypeViolation[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => {
      collectViolations(entry, canonical, opIndex, `${path}.${String(i)}`, violations);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }

  if (isComponentShape(value)) {
    const registered = canonical.get(componentTypeKey(value.type));
    if (registered === undefined) {
      violations.push({
        opIndex,
        path,
        type: value.type,
        code: 'unknown_component_type',
        message:
          `Unknown component type "${value.type}" at "${path}". `
          + `Registered types: ${[...canonical.values()].sort().join(', ')}.`,
      });
    } else if (registered !== value.type) {
      violations.push({
        opIndex,
        path,
        type: value.type,
        code: 'component_type_case_mismatch',
        message:
          `Component type "${value.type}" at "${path}" does not match the registered `
          + `casing "${registered}". Component types are case-sensitive — use "${registered}".`,
      });
    }
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectViolations(child, canonical, opIndex, `${path}.${key}`, violations);
  }
}

/**
 * Returns every component-type problem in a batch of operations.
 *
 * An empty registry yields no violations. The registry is only populated once
 * the editor (or the CI sync) has run for a site, so failing closed would block
 * all agent writes to a site that simply has not synced yet. Callers should log
 * that they skipped — see the caller in realtime-api.
 */
export function findComponentTypeViolations(
  operations: unknown[],
  canonical: CanonicalComponentNames,
): ComponentTypeViolation[] {
  if (canonical.size === 0) {
    return [];
  }

  const violations: ComponentTypeViolation[] = [];
  operations.forEach((rawOp, opIndex) => {
    const op = rawOp as OperationLike;
    // Only value-carrying ops can introduce a component. `value` is the
    // backend's field name (set/insert/replace); `content` is accepted too
    // because agent-facing callers use that name and normalize late.
    for (const candidate of [op.value, op.content]) {
      if (candidate === undefined) continue;
      collectViolations(
        candidate,
        canonical,
        opIndex,
        typeof op.path === 'string' && op.path !== '' ? op.path : String(opIndex),
        violations,
      );
    }
  });
  return violations;
}
