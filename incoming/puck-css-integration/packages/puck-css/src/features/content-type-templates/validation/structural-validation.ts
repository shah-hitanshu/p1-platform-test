/**
 * Structural Validation
 *
 * Validates that a document conforms to its template's structural requirements.
 */

import type { Data } from '@puckeditor/core';
import type { Template } from '../types.js';

export type ValidationErrorCode =
  | 'MISSING_PINNED_COMPONENT'
  | 'PINNED_COMPONENT_OUT_OF_ORDER'
  | 'UNEXPECTED_COMPONENT_AT_PINNED_SLOT';

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  componentType?: string;
  expectedIndex?: number;
  actualIndex?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate that document data conforms to template structure.
 *
 * A document conforms if:
 * - All pinned components from template are present
 * - Pinned components appear in the same relative order
 * - Extra non-pinned components are allowed
 */
export function validateStructure(data: Data, template: Template): ValidationResult {
  const errors: ValidationError[] = [];

  // Pinned component types in template content order: an instance is pinned
  // when its id maps to true in root.props._pinMap.
  const pinMap = template.root?.props?._pinMap ?? {};
  const expectedTypes = (template.content ?? [])
    .filter((c) => pinMap[c.props.id] === true)
    .map((c) => c.type);

  if (expectedTypes.length === 0) {
    // No structural requirements
    return { valid: true, errors: [] };
  }

  const documentTypes = data.content.map((c) => c.type);
  const foundIndices: number[] = [];
  const usedIndices = new Set<number>();

  for (const expectedType of expectedTypes) {
    let idx = -1;
    for (let j = 0; j < documentTypes.length; j++) {
      if (documentTypes[j] === expectedType && !usedIndices.has(j)) {
        idx = j;
        break;
      }
    }
    if (idx !== -1) usedIndices.add(idx);
    foundIndices.push(idx);
  }

  // Check for missing components and order
  for (let i = 0; i < expectedTypes.length; i++) {
    const expectedType = expectedTypes[i];
    const foundIndex = foundIndices[i];

    if (foundIndex === undefined || foundIndex === -1) {
      errors.push({
        code: 'MISSING_PINNED_COMPONENT',
        message: `Missing required pinned component: ${expectedType}`,
        componentType: expectedType,
        expectedIndex: i,
      });
    } else {
      const prevIndex = foundIndices[i - 1];
      if (i > 0 && prevIndex !== undefined && prevIndex !== -1 && foundIndex < prevIndex) {
        // Current component found before previous one - out of order
        errors.push({
          code: 'PINNED_COMPONENT_OUT_OF_ORDER',
          message: `Pinned component out of order: ${expectedType}`,
          componentType: expectedType,
          expectedIndex: i,
          actualIndex: foundIndex,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
