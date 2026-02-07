/**
 * Phase 3b: Field-Level Conflict Resolution - classifyFields Tests (TDD)
 *
 * Tests for the pure function that classifies fields as source-only,
 * target-only, or conflicting by comparing source and target snapshots
 * against a base snapshot.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyFields,
} from '../../components/field-resolution/classifyFields';

describe('classifyFields', () => {
  it('should classify fields changed only in source', () => {
    const base = { title: 'Original', body: 'Content' };
    const source = { title: 'Changed in Source', body: 'Content' };
    const target = { title: 'Original', body: 'Content' };

    const result = classifyFields(source, target, base);

    const titleField = result.find((f) => f.fieldPath === '/title');
    expect(titleField).toBeDefined();
    expect(titleField!.classification).toBe('source-only');
    expect(titleField!.sourceValue).toBe('Changed in Source');
    expect(titleField!.targetValue).toBe('Original');
    expect(titleField!.baseValue).toBe('Original');
  });

  it('should classify fields changed only in target', () => {
    const base = { title: 'Original', body: 'Content' };
    const source = { title: 'Original', body: 'Content' };
    const target = { title: 'Original', body: 'Changed in Target' };

    const result = classifyFields(source, target, base);

    const bodyField = result.find((f) => f.fieldPath === '/body');
    expect(bodyField).toBeDefined();
    expect(bodyField!.classification).toBe('target-only');
  });

  it('should classify fields changed in both as conflicting', () => {
    const base = { title: 'Original' };
    const source = { title: 'Source Version' };
    const target = { title: 'Target Version' };

    const result = classifyFields(source, target, base);

    const titleField = result.find((f) => f.fieldPath === '/title');
    expect(titleField).toBeDefined();
    expect(titleField!.classification).toBe('conflicting');
    expect(titleField!.sourceValue).toBe('Source Version');
    expect(titleField!.targetValue).toBe('Target Version');
  });

  it('should not classify unchanged fields', () => {
    const base = { title: 'Same', body: 'Same' };
    const source = { title: 'Same', body: 'Same' };
    const target = { title: 'Same', body: 'Same' };

    const result = classifyFields(source, target, base);

    // No fields should be classified since nothing changed
    expect(result).toHaveLength(0);
  });

  it('should handle fields added in source only', () => {
    const base = { title: 'Original' };
    const source = { title: 'Original', newField: 'Added by source' };
    const target = { title: 'Original' };

    const result = classifyFields(source, target, base);

    const newField = result.find((f) => f.fieldPath === '/newField');
    expect(newField).toBeDefined();
    expect(newField!.classification).toBe('source-only');
    expect(newField!.sourceValue).toBe('Added by source');
    expect(newField!.baseValue).toBeUndefined();
  });

  it('should handle fields removed in source only', () => {
    const base = { title: 'Original', toRemove: 'Exists' };
    const source = { title: 'Original' };
    const target = { title: 'Original', toRemove: 'Exists' };

    const result = classifyFields(source, target, base);

    const removedField = result.find((f) => f.fieldPath === '/toRemove');
    expect(removedField).toBeDefined();
    expect(removedField!.classification).toBe('source-only');
    expect(removedField!.sourceValue).toBeUndefined();
    expect(removedField!.baseValue).toBe('Exists');
  });

  it('should handle nested object fields', () => {
    const base = { meta: { author: 'Alice', date: '2026-01-01' } };
    const source = { meta: { author: 'Bob', date: '2026-01-01' } };
    const target = { meta: { author: 'Alice', date: '2026-02-01' } };

    const result = classifyFields(source, target, base);

    const authorField = result.find((f) => f.fieldPath === '/meta/author');
    expect(authorField).toBeDefined();
    expect(authorField!.classification).toBe('source-only');

    const dateField = result.find((f) => f.fieldPath === '/meta/date');
    expect(dateField).toBeDefined();
    expect(dateField!.classification).toBe('target-only');
  });

  it('should handle arrays as atomic values', () => {
    const base = { tags: ['a', 'b'] };
    const source = { tags: ['a', 'b', 'c'] };
    const target = { tags: ['a', 'b'] };

    const result = classifyFields(source, target, base);

    const tagsField = result.find((f) => f.fieldPath === '/tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.classification).toBe('source-only');
  });

  it('should work without a base snapshot (all fields are conflicting if different)', () => {
    const source = { title: 'Source', body: 'Same' };
    const target = { title: 'Target', body: 'Same' };

    const result = classifyFields(source, target, null);

    const titleField = result.find((f) => f.fieldPath === '/title');
    expect(titleField).toBeDefined();
    expect(titleField!.classification).toBe('conflicting');
    // body is same in both, should not be classified
    expect(result.find((f) => f.fieldPath === '/body')).toBeUndefined();
  });

  it('should generate readable labels for classified fields', () => {
    const base = { backgroundColor: 'white' };
    const source = { backgroundColor: 'blue' };
    const target = { backgroundColor: 'white' };

    const result = classifyFields(source, target, base);

    const bgField = result.find((f) => f.fieldPath === '/backgroundColor');
    expect(bgField).toBeDefined();
    expect(bgField!.label.toLowerCase()).toContain('background');
  });
});
