/**
 * Phase 3b: Field-Level Conflict Resolution - mergeSnapshots Tests (TDD)
 *
 * Tests for the pure function that takes two snapshots + user field
 * selections and produces a merged snapshot.
 *
 * Written BEFORE implementation following TDD methodology.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeSnapshots,
  type FieldSelection,
} from '../../components/field-resolution/mergeSnapshots';

describe('mergeSnapshots', () => {
  it('should produce merged output taking source for specified fields', () => {
    const source = { title: 'Source Title', body: 'Source Body' };
    const target = { title: 'Target Title', body: 'Target Body' };
    const selections: FieldSelection[] = [
      { fieldPath: '/title', choice: 'source' },
      { fieldPath: '/body', choice: 'target' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result.title).toBe('Source Title');
    expect(result.body).toBe('Target Body');
  });

  it('should produce merged output taking target for specified fields', () => {
    const source = { title: 'Source', description: 'Source Desc' };
    const target = { title: 'Target', description: 'Target Desc' };
    const selections: FieldSelection[] = [
      { fieldPath: '/title', choice: 'target' },
      { fieldPath: '/description', choice: 'target' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result.title).toBe('Target');
    expect(result.description).toBe('Target Desc');
  });

  it('should handle custom values', () => {
    const source = { title: 'Source' };
    const target = { title: 'Target' };
    const selections: FieldSelection[] = [
      { fieldPath: '/title', choice: 'custom', customValue: 'My Custom Title' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result.title).toBe('My Custom Title');
  });

  it('should preserve unselected fields from target by default', () => {
    const source = { title: 'Source', unchanged: 'Keep This' };
    const target = { title: 'Target', unchanged: 'Keep This' };
    const selections: FieldSelection[] = [
      { fieldPath: '/title', choice: 'source' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result.title).toBe('Source');
    expect(result.unchanged).toBe('Keep This');
  });

  it('should handle nested field paths', () => {
    const source = { meta: { author: 'Alice', date: '2026-01-01' } };
    const target = { meta: { author: 'Bob', date: '2026-02-01' } };
    const selections: FieldSelection[] = [
      { fieldPath: '/meta/author', choice: 'source' },
      { fieldPath: '/meta/date', choice: 'target' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect((result.meta as Record<string, unknown>).author).toBe('Alice');
    expect((result.meta as Record<string, unknown>).date).toBe('2026-02-01');
  });

  it('should handle field additions from source', () => {
    const source = { title: 'Title', newField: 'New Value' };
    const target = { title: 'Title' };
    const selections: FieldSelection[] = [
      { fieldPath: '/newField', choice: 'source' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result.newField).toBe('New Value');
  });

  it('should handle field removals from source', () => {
    const source = { title: 'Title' };
    const target = { title: 'Title', toRemove: 'Exists' };
    const selections: FieldSelection[] = [
      { fieldPath: '/toRemove', choice: 'source' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result.toRemove).toBeUndefined();
  });

  it('should handle empty selections (returns target snapshot)', () => {
    const source = { title: 'Source' };
    const target = { title: 'Target' };

    const result = mergeSnapshots(source, target, []);

    expect(result.title).toBe('Target');
  });

  it('should handle all fields selected as source', () => {
    const source = { a: 1, b: 2, c: 3 };
    const target = { a: 10, b: 20, c: 30 };
    const selections: FieldSelection[] = [
      { fieldPath: '/a', choice: 'source' },
      { fieldPath: '/b', choice: 'source' },
      { fieldPath: '/c', choice: 'source' },
    ];

    const result = mergeSnapshots(source, target, selections);

    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });
});
