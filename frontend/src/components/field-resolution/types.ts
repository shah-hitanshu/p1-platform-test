/**
 * Field-Level Conflict Resolution Types
 */

/**
 * Classification of a field's change status between branches.
 */
export type FieldClassificationType = 'source-only' | 'target-only' | 'conflicting';

/**
 * A classified field with values from both snapshots.
 */
export interface FieldClassification {
  fieldPath: string;
  label: string;
  classification: FieldClassificationType;
  sourceValue: unknown;
  targetValue: unknown;
  baseValue?: unknown;
}

/**
 * User's choice for how to resolve a field.
 */
export type FieldChoice = 'source' | 'target' | 'custom';

/**
 * A user's selection for a single field.
 */
export interface FieldSelection {
  fieldPath: string;
  choice: FieldChoice;
  customValue?: unknown;
}

/**
 * The result of merging snapshots with field selections.
 */
export type MergeResult = Record<string, unknown>;
