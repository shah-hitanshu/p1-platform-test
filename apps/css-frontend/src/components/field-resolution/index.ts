/**
 * Field-Level Conflict Resolution
 *
 * Components and utilities for resolving merge conflicts field-by-field.
 */

export { FieldResolutionPanel } from './FieldResolutionPanel';
export { FieldConflictRow } from './FieldConflictRow';
export { AutoMergedFields } from './AutoMergedFields';
export { MergedPreview } from './MergedPreview';
export { CrdtPreviewButton } from './CrdtPreviewButton';
export { classifyFields } from './classifyFields';
export { mergeSnapshots } from './mergeSnapshots';
export type {
  FieldClassification,
  FieldClassificationType,
  FieldChoice,
  FieldSelection,
  MergeResult,
} from './types';
