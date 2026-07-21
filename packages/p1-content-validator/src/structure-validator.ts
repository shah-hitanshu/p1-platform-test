import type {
  StructuralConformanceError,
  ValidateStructureInput,
} from './types.js';

/** Returns the value when it is a plain object, otherwise undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Validates that a document snapshot conforms to a template's structural skeleton.
 *
 * A template component is pinned when `root.props._pinMap[props.id]` is `true`;
 * pinned types are checked in template `content` order.
 *
 * Conformance rules:
 * 1. All pinned components must be present in the document
 * 2. Pinned components must appear in the same relative order as in the template
 * 3. Non-pinned components are allowed and do not affect conformance
 *
 * This implements partial conformance: documents may have additional components
 * beyond the pinned skeleton without failing validation.
 *
 * DEFENSIVE DESIGN: This function is designed to never crash, even with malformed
 * inputs. All property accesses use optional chaining, and all array operations
 * verify types before use.
 *
 * @param input - Document snapshot and template snapshot to validate against
 * @returns Object with array of structural conformance errors (empty if valid)
 */
export function validateDocumentStructure(
  input: ValidateStructureInput,
): { errors: StructuralConformanceError[] } {
  const { documentSnapshot, templateSnapshot } = input;
  const errors: StructuralConformanceError[] = [];

  // Puck snapshots store the component array at top-level `content`, but some
  // wrappers nest it under `root.props.content`. Check both, fall back to empty.
  const topLevelContent = documentSnapshot?.content;
  const contentRaw = Array.isArray(topLevelContent)
    ? topLevelContent
    : asRecord(asRecord(documentSnapshot?.root)?.props)?.content;
  const content = Array.isArray(contentRaw)
    ? (contentRaw as { type?: string }[])
    : [];

  const templateContent = Array.isArray(templateSnapshot?.content)
    ? (templateSnapshot.content as { type?: unknown; props?: unknown }[])
    : [];

  // A component is pinned only when root.props._pinMap[props.id] is true.
  const pinMap = asRecord(asRecord(asRecord(templateSnapshot?.root)?.props)?._pinMap) ?? {};

  // Pinned component types in template content order.
  // A component without a string type or string id is never pinned.
  const pinnedTypes: string[] = [];
  for (const templateComponent of templateContent) {
    if (!templateComponent || typeof templateComponent.type !== 'string') {
      continue;
    }
    const id = asRecord(templateComponent.props)?.id;
    if (typeof id === 'string' && pinMap[id] === true) {
      pinnedTypes.push(templateComponent.type);
    }
  }

  // If template has no pinned components, document always conforms
  if (pinnedTypes.length === 0) {
    return { errors };
  }

  // Build a map of pinned component types to their indices in the document
  // Defensively handle components without type field or with non-string types
  const pinnedIndices = new Map<string, number[]>();
  content.forEach((component, index) => {
    // Skip components without a valid type field
    if (!component || typeof component.type !== 'string') {
      return;
    }

    if (pinnedTypes.includes(component.type)) {
      const indices = pinnedIndices.get(component.type) || [];
      indices.push(index);
      pinnedIndices.set(component.type, indices);
    }
  });

  // Track the last index we successfully matched to ensure ordering
  let lastFoundIndex = -1;

  // Check each pinned component in template order
  for (let i = 0; i < pinnedTypes.length; i++) {
    const expectedType = pinnedTypes[i];
    const indices = pinnedIndices.get(expectedType) || [];

    // Find the first occurrence of this component type after lastFoundIndex
    const foundIndex = indices.find((idx) => idx > lastFoundIndex);

    if (foundIndex === undefined) {
      // No unconsumed occurrence appears after the last match. If the document
      // holds fewer instances of this type than the template pins up to here,
      // a required instance is absent; otherwise the instances that exist sit
      // before where this one must appear.
      let requiredSoFar = 0;
      for (let j = 0; j <= i; j++) {
        if (pinnedTypes[j] === expectedType) requiredSoFar++;
      }
      if (indices.length < requiredSoFar) {
        errors.push({
          code: 'missing_pinned_component',
          componentType: expectedType,
          message: `Required component "${expectedType}" is missing from the document.`,
        });
      } else {
        // Component exists but is out of order (appears before lastFoundIndex)
        errors.push({
          code: 'pinned_component_out_of_order',
          componentType: expectedType,
          expectedIndex: i,
          actualIndex: indices[0],
          message:
            `Pinned component "${expectedType}" appears out of order. ` +
            `Expected after index ${lastFoundIndex} but found at index ${indices[0]}.`,
        });
      }
    } else {
      // Component found in correct relative order
      lastFoundIndex = foundIndex;
    }
  }

  return { errors };
}
