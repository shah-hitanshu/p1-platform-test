import type {
  StructuralConformanceError,
  ValidateStructureInput,
} from './types.js';

/**
 * Validates that a document snapshot conforms to a template's structural skeleton.
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

  // Defensively extract content array from document snapshot.
  // Puck snapshots store the component array at top-level `content`,
  // but some wrappers nest it under `root.props.content`. Check both paths.
  const topLevelContent = documentSnapshot?.content;
  let contentRaw: unknown;

  if (Array.isArray(topLevelContent)) {
    contentRaw = topLevelContent;
  } else {
    const root = documentSnapshot?.root;
    const isRootValid = root !== null && typeof root === 'object' && !Array.isArray(root);
    const props = isRootValid ? (root as Record<string, unknown>).props : undefined;
    const isPropsValid = props !== null && typeof props === 'object' && !Array.isArray(props);
    contentRaw = isPropsValid ? (props as Record<string, unknown>).content : undefined;
  }

  // Gracefully handle missing or malformed content - always fall back to empty array
  const content = Array.isArray(contentRaw)
    ? (contentRaw as { type?: string }[])
    : [];

  // Defensively handle template components array
  // Handle null, undefined, or non-array values
  const templateComponents = Array.isArray(templateSnapshot?.components)
    ? templateSnapshot.components
    : [];

  // Filter template for pinned components only
  const pinnedComponents = templateComponents.filter((c) => c?.pinned === true);

  // If template has no pinned components, document always conforms
  if (pinnedComponents.length === 0) {
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

    if (pinnedComponents.some((p) => p.type === component.type)) {
      const indices = pinnedIndices.get(component.type) || [];
      indices.push(index);
      pinnedIndices.set(component.type, indices);
    }
  });

  // Track the last index we successfully matched to ensure ordering
  let lastFoundIndex = -1;

  // Check each pinned component in template order
  for (let i = 0; i < pinnedComponents.length; i++) {
    const expected = pinnedComponents[i];
    const indices = pinnedIndices.get(expected.type) || [];

    // Find the first occurrence of this component type after lastFoundIndex
    const foundIndex = indices.find((idx) => idx > lastFoundIndex);

    if (foundIndex === undefined) {
      // Component is missing or out of order
      // Check if the component exists anywhere in the document
      if (indices.length === 0) {
        errors.push({
          code: 'missing_pinned_component',
          componentType: expected.type,
          message: `Required component "${expected.type}" is missing from the document.`,
        });
      } else {
        // Component exists but is out of order (appears before lastFoundIndex)
        errors.push({
          code: 'pinned_component_out_of_order',
          componentType: expected.type,
          expectedIndex: i,
          actualIndex: indices[0],
          message:
            `Pinned component "${expected.type}" appears out of order. ` +
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
